-- RET-001: return request (E10, REQUESTED stage only). TECH_DESIGN §3.24, §3.25, §11, §6; PRD §20.
--
-- What this migration does:
--   * creates returns / return_items (a return request and its lines),
--   * lets the Admin create a REQUESTED return for goods that were really delivered, through ONE trusted RPC,
--   * lets the Admin read it (RLS), audits every change.
--
-- What it deliberately does NOT do (separate tasks, no business rule invented here):
--   * it never touches inventory_movements / inventory_balances / inventory_reservations: nothing is received yet, so
--     nothing enters Pending Inspection (RET-002), nothing is restocked or marked damaged (RET-003..005);
--   * no refund, revenue or commission adjustment (RET-006, RET-007, COM-005);
--   * it does NOT move the order from COMPLETED to RETURNED. TECH_DESIGN §6 says "COMPLETED --> RETURNED: Return created", but
--     RETURNED has no outgoing edge, payments can no longer be confirmed on an order in RETURNED, and the return state machine
--     (§11) has no rejected/cancelled state, so flipping a whole order on a request (possibly for one unit, possibly never
--     received) could not be undone. The meaning (any request? only a full return? on closure?) is a
--     product decision: see docs/exec-plans/active/RET-001-return-request.md. The guard keeps the edge as it is.
--   * no role other than ADMIN may request: PERMISSION_MATRIX has no return permission and none is invented here.
--
-- Counting rule (documented once, used by the RPC and by the guard):
--   returnable = delivered_quantity - greatest(returned_quantity, SUM(return_items.quantity of every request for the line)).
--   Every request counts, whatever its status: the return state machine has no rejected/cancelled state, and counting all of
--   them also avoids double counting when a later task copies a closed request into order_items.returned_quantity.

create sequence private.return_code_seq as bigint start with 1 minvalue 1;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.returns (
  id uuid primary key default gen_random_uuid(),
  return_code text not null unique,
  order_id uuid not null references public.orders (id),
  reason text not null check (btrim(reason) <> '' and char_length(reason) <= 500),
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'RECEIVED_PENDING_INSPECTION', 'RESTOCKED', 'DAMAGED', 'CLOSED')),
  created_by uuid not null references public.profiles (id),
  inspected_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  inspected_at timestamptz,
  -- A request that is still waiting has not been inspected.
  constraint returns_requested_is_clean check (
    status not in ('REQUESTED', 'RECEIVED_PENDING_INSPECTION') or (inspected_by is null and inspected_at is null)
  )
);

create index returns_order_idx on public.returns (order_id);
create index returns_status_idx on public.returns (status, created_at desc);
create index returns_created_by_idx on public.returns (created_by);

-- batch_id and inspection_result stay NULL at request time: goods are not received, so no batch or verdict exists yet.
create table public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns (id),
  order_item_id uuid not null references public.order_items (id),
  product_id uuid not null references public.products (id),
  batch_id uuid references public.product_batches (id),
  quantity int not null check (quantity > 0),
  inspection_result text,
  constraint return_items_return_line_key unique (return_id, order_item_id)
);

create index return_items_return_idx on public.return_items (return_id);
create index return_items_order_item_idx on public.return_items (order_item_id);

-- ---------------------------------------------------------------------------
-- Counting rule. Callers lock the order_items row first (FOR UPDATE) so concurrent requests serialize.
-- ---------------------------------------------------------------------------
create or replace function private.returnable_quantity(p_order_item_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select oi.delivered_quantity::bigint - greatest(
    oi.returned_quantity::bigint,
    coalesce((select sum(ri.quantity) from public.return_items ri where ri.order_item_id = oi.id), 0)::bigint
  )
  from public.order_items oi
  where oi.id = p_order_item_id
$$;

revoke all on function private.returnable_quantity(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guards (apply to every role, including the service role)
-- ---------------------------------------------------------------------------
create or replace function private.returns_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq bigint;
  v_order_status text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa yêu cầu trả hàng. Dữ liệu giao dịch chỉ được đóng, không được xóa.';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'REQUESTED' then
      raise exception 'Yêu cầu trả hàng mới phải ở trạng thái REQUESTED.';
    end if;
    select o.status into v_order_status from public.orders o where o.id = new.order_id for share;
    if v_order_status is distinct from 'COMPLETED' then
      raise exception 'Chỉ tạo được yêu cầu trả hàng cho đơn đã hoàn tất.';
    end if;
    -- Always generated here: a value supplied by a caller is ignored. Gaps are possible (rollbacks).
    -- At least six digits (RET-000001); lpad would TRUNCATE longer values, so pad only short ones.
    v_seq := nextval('private.return_code_seq');
    new.return_code := 'RET-' || case when v_seq < 1000000 then lpad(v_seq::text, 6, '0') else v_seq::text end;
    return new;
  end if;

  if new.return_code is distinct from old.return_code
     or new.order_id is distinct from old.order_id
     or new.reason is distinct from old.reason
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Không được đổi mã, đơn hàng, lý do hay người tạo của yêu cầu trả hàng.';
  end if;

  -- TECH_DESIGN §11: REQUESTED -> RECEIVED_PENDING_INSPECTION -> RESTOCKED | DAMAGED -> CLOSED.
  if new.status is distinct from old.status and (old.status, new.status) not in (
    ('REQUESTED', 'RECEIVED_PENDING_INSPECTION'),
    ('RECEIVED_PENDING_INSPECTION', 'RESTOCKED'), ('RECEIVED_PENDING_INSPECTION', 'DAMAGED'),
    ('RESTOCKED', 'CLOSED'), ('DAMAGED', 'CLOSED')
  ) then
    raise exception 'Không thể chuyển yêu cầu trả hàng từ % sang %.', old.status, new.status;
  end if;
  return new;
end;
$$;

create or replace function private.return_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return public.returns;
  v_item public.order_items;
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa dòng sản phẩm của yêu cầu trả hàng.';
  end if;

  if tg_op = 'INSERT' then
    select * into v_return from public.returns r where r.id = new.return_id;
    if v_return.status is distinct from 'REQUESTED' then
      raise exception 'Chỉ thêm được sản phẩm khi yêu cầu trả hàng còn ở trạng thái REQUESTED.';
    end if;
    -- Serializes concurrent requests for the same line; the counting rule below reads under this lock.
    select * into v_item from public.order_items i where i.id = new.order_item_id for update;
    if not found or v_item.order_id <> v_return.order_id then
      raise exception 'Dòng sản phẩm không thuộc đơn hàng của yêu cầu trả hàng.';
    end if;
    if new.product_id is distinct from v_item.product_id then
      raise exception 'Sản phẩm của dòng trả hàng phải trùng với sản phẩm của dòng đơn hàng.';
    end if;
    if new.batch_id is not null or new.inspection_result is not null then
      raise exception 'Dòng của yêu cầu mới chưa có lô hàng hay kết quả kiểm tra.';
    end if;
    if new.quantity > private.returnable_quantity(new.order_item_id) then
      raise exception 'Số lượng trả vượt quá số lượng đã giao còn có thể trả của dòng sản phẩm.';
    end if;
    return new;
  end if;

  if new.return_id is distinct from old.return_id
     or new.order_item_id is distinct from old.order_item_id
     or new.product_id is distinct from old.product_id
     or new.quantity is distinct from old.quantity then
    raise exception 'Không được đổi yêu cầu, dòng đơn hàng, sản phẩm hay số lượng của dòng trả hàng.';
  end if;
  return new;
end;
$$;

create or replace function private.returns_no_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Không được xóa toàn bộ dữ liệu trả hàng.';
end;
$$;

create trigger returns_guard_write
  before insert or update or delete on public.returns
  for each row execute function private.returns_guard();
create trigger return_items_guard_write
  before insert or update or delete on public.return_items
  for each row execute function private.return_items_guard();
create trigger returns_no_truncate
  before truncate on public.returns
  for each statement execute function private.returns_no_truncate();
create trigger return_items_no_truncate
  before truncate on public.return_items
  for each statement execute function private.returns_no_truncate();

revoke all on function private.returns_guard(), private.return_items_guard(),
  private.returns_no_truncate() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access: only the Admin reads returns (no wider read rule is specified). Nobody writes these tables directly;
-- the RPC below is the only door.
-- ---------------------------------------------------------------------------
alter table public.returns enable row level security;
alter table public.return_items enable row level security;

revoke all on table public.returns, public.return_items from anon;
revoke insert, update, delete, truncate on table public.returns, public.return_items from authenticated;

create policy returns_select_admin on public.returns
  for select to authenticated
  using ((select private.is_admin()));

-- The sub-select is itself subject to the returns policy above.
create policy return_items_select_via_return on public.return_items
  for select to authenticated
  using (exists (select 1 from public.returns r where r.id = return_id));

create trigger audit_returns after insert or update on public.returns
  for each row execute function private.audit_row_change();
create trigger audit_return_items after insert or update on public.return_items
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- The request operation
--   p_items: [{"order_item_id": "<uuid>", "quantity": <integer >= 1>}, ...], 1..50 distinct lines of ONE order.
--   Keep the limits identical to MAX_RETURN_LINES / MAX_RETURN_REASON_LENGTH / MAX_LINE_QUANTITY in
--   src/domain/returns/request.ts.
--   The product is taken from the order line, never from the caller. The order is not changed.
-- ---------------------------------------------------------------------------
create or replace function public.request_return(
  p_order_id uuid,
  p_items jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_lines constant int := 50;
  c_max_reason constant int := 500;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_order public.orders;
  v_line jsonb;
  v_id uuid;
  v_qty int;
  v_ids uuid[] := '{}';
  v_item public.order_items;
  v_sku text;
  v_left bigint;
  v_return public.returns;
begin
  if not private.is_admin() then
    raise exception 'Chỉ Admin được tạo yêu cầu trả hàng.' using errcode = '42501';
  end if;

  if p_order_id is null then
    raise exception 'Vui lòng chọn đơn hàng cần trả.';
  end if;

  if v_reason = '' then
    raise exception 'Vui lòng nhập lý do trả hàng.';
  end if;
  if char_length(v_reason) > c_max_reason then
    raise exception 'Lý do tối đa % ký tự.', c_max_reason;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Vui lòng chọn ít nhất một sản phẩm cần trả.';
  end if;
  if jsonb_array_length(p_items) > c_max_lines then
    raise exception 'Mỗi yêu cầu trả hàng có tối đa % sản phẩm.', c_max_lines;
  end if;

  -- Shape of every line first (no database access), so a malformed request fails before any lock is taken.
  for v_line in select e from jsonb_array_elements(p_items) as t(e) loop
    if jsonb_typeof(v_line -> 'order_item_id') is distinct from 'string'
       or (v_line ->> 'order_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Dòng sản phẩm không hợp lệ.';
    end if;
    if jsonb_typeof(v_line -> 'quantity') is distinct from 'number'
       or (v_line ->> 'quantity') !~ '^[0-9]{1,9}$' then
      raise exception 'Số lượng trả phải là số nguyên lớn hơn 0.';
    end if;
    if (v_line ->> 'quantity')::int < 1 then
      raise exception 'Số lượng trả phải là số nguyên lớn hơn 0.';
    end if;
    v_id := (v_line ->> 'order_item_id')::uuid;
    if v_id = any (v_ids) then
      raise exception 'Mỗi sản phẩm chỉ được xuất hiện một lần trong yêu cầu trả hàng.';
    end if;
    v_ids := v_ids || v_id;
  end loop;

  -- FOR SHARE: the order cannot leave COMPLETED between this check and the insert.
  select * into v_order from public.orders where id = p_order_id for share;
  if not found then
    raise exception 'Đơn hàng không tồn tại.';
  end if;
  if v_order.status <> 'COMPLETED' then
    raise exception 'Chỉ tạo được yêu cầu trả hàng cho đơn đã hoàn tất (đơn này đang ở trạng thái %).', v_order.status;
  end if;

  -- Lock the lines in a fixed order so two requests over the same lines cannot deadlock.
  perform 1 from public.order_items where id = any (v_ids) order by id for update;

  for v_line in select e from jsonb_array_elements(p_items) as t(e) loop
    v_id := (v_line ->> 'order_item_id')::uuid;
    v_qty := (v_line ->> 'quantity')::int;
    select * into v_item from public.order_items where id = v_id and order_id = p_order_id;
    if not found then
      raise exception 'Dòng sản phẩm không thuộc đơn hàng này.';
    end if;
    select p.sku into v_sku from public.products p where p.id = v_item.product_id;
    if v_item.delivered_quantity = 0 then
      raise exception 'Sản phẩm % chưa được giao nên không thể trả.', v_sku;
    end if;
    v_left := private.returnable_quantity(v_id);
    if v_qty > v_left then
      raise exception
        'Sản phẩm % chỉ còn có thể trả tối đa % (đã giao %, đã trả hoặc đã có yêu cầu trả %).',
        v_sku, v_left, v_item.delivered_quantity, v_item.delivered_quantity - v_left;
    end if;
  end loop;

  perform set_config('app.audit_reason', 'Yêu cầu trả hàng', true);

  insert into public.returns (return_code, order_id, reason, created_by)
  values ('', p_order_id, v_reason, (select auth.uid()))
  returning * into v_return;

  insert into public.return_items (return_id, order_item_id, product_id, quantity)
  select v_return.id, oi.id, oi.product_id, (t.e ->> 'quantity')::int
  from jsonb_array_elements(p_items) with ordinality as t(e, n)
  join public.order_items oi on oi.id = (t.e ->> 'order_item_id')::uuid
  order by t.n;

  perform set_config('app.audit_reason', '', true);

  return to_jsonb(v_return) || jsonb_build_object('items', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'order_item_id', i.order_item_id, 'product_id', i.product_id, 'quantity', i.quantity)
      order by i.id), '[]'::jsonb)
    from public.return_items i
    where i.return_id = v_return.id));
end;
$$;

revoke all on function public.request_return(uuid, jsonb, text) from public, anon;
grant execute on function public.request_return(uuid, jsonb, text) to authenticated;
