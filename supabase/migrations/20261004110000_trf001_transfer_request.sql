-- TRF-001: transfer request (E08, request stage only). TECH_DESIGN §3.15, §3.16, §8; PRD §B16.
--
-- What this migration does:
--   * creates transfers / transfer_items (a request and its lines),
--   * lets a role holding `propose_transfer` create a REQUESTED transfer through ONE trusted RPC,
--   * lets the requester and the Admin read it (RLS), audits every change.
--
-- What it deliberately does NOT do (separate tasks, no business rule invented here):
--   * it never touches inventory_movements / inventory_balances / inventory_reservations: a request moves no stock,
--     reserves nothing, selects no batch (batch_id stays NULL until TRF-004) and is not revenue;
--   * no approve / reject / cancel / dispatch / receive RPC exists yet (TRF-003, 005..008). The guard below already enforces the
--     approved state machine (TECH_DESIGN §8) so that those tasks cannot skip a state.
--   * inventory_movements.transfer_id keeps no FK yet: the dispatch task that first writes a transfer movement adds it.

create sequence private.transfer_code_seq as bigint start with 1 minvalue 1;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  transfer_code text not null unique,
  requested_by uuid not null references public.profiles (id),
  source_location_id uuid not null references public.locations (id),
  destination_location_id uuid not null references public.locations (id),
  status text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'APPROVED', 'REJECTED', 'DISPATCHED', 'RECEIVED', 'CANCELLED')),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  dispatched_at timestamptz,
  received_at timestamptz,
  reason text not null check (btrim(reason) <> '' and char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  constraint transfers_locations_differ check (source_location_id <> destination_location_id),
  -- A request that is still waiting has not been approved, dispatched or received.
  constraint transfers_requested_is_clean check (
    status <> 'REQUESTED'
    or (approved_by is null and approved_at is null and dispatched_at is null and received_at is null)
  )
);

create index transfers_requested_by_idx on public.transfers (requested_by, created_at desc);
create index transfers_status_idx on public.transfers (status, created_at desc);
create index transfers_source_idx on public.transfers (source_location_id);
create index transfers_destination_idx on public.transfers (destination_location_id);

-- batch_id is nullable: the specs give the table a batch FK, but the request stage must not choose batches (TRF-004 does).
create table public.transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (id),
  product_id uuid not null references public.products (id),
  batch_id uuid references public.product_batches (id),
  requested_qty int not null check (requested_qty > 0),
  approved_qty int not null default 0 check (approved_qty >= 0),
  dispatched_qty int not null default 0 check (dispatched_qty >= 0),
  received_qty int not null default 0 check (received_qty >= 0)
);

create index transfer_items_transfer_idx on public.transfer_items (transfer_id);
create index transfer_items_product_idx on public.transfer_items (product_id);

-- ---------------------------------------------------------------------------
-- Guards (apply to every role, including the service role)
-- ---------------------------------------------------------------------------
create or replace function private.transfers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq bigint;
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa yêu cầu điều chuyển. Hãy từ chối hoặc hủy yêu cầu kèm lý do.';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'REQUESTED' then
      raise exception 'Yêu cầu điều chuyển mới phải ở trạng thái REQUESTED.';
    end if;
    -- Always generated here: a value supplied by a caller is ignored. Gaps are possible (rollbacks).
    -- At least four digits (TR-0001); lpad would TRUNCATE longer values (10000 -> 1000), so pad only short ones.
    v_seq := nextval('private.transfer_code_seq');
    new.transfer_code := 'TR-' || case when v_seq < 10000 then lpad(v_seq::text, 4, '0') else v_seq::text end;
    return new;
  end if;

  if new.transfer_code is distinct from old.transfer_code
     or new.requested_by is distinct from old.requested_by
     or new.source_location_id is distinct from old.source_location_id
     or new.destination_location_id is distinct from old.destination_location_id
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at then
    raise exception 'Không được đổi mã, người yêu cầu, kho xuất, kho nhận hay lý do của yêu cầu điều chuyển.';
  end if;

  -- TECH_DESIGN §8: REQUESTED -> APPROVED | REJECTED | CANCELLED, APPROVED -> DISPATCHED | CANCELLED, DISPATCHED -> RECEIVED.
  if new.status is distinct from old.status and (old.status, new.status) not in (
    ('REQUESTED', 'APPROVED'), ('REQUESTED', 'REJECTED'), ('REQUESTED', 'CANCELLED'),
    ('APPROVED', 'DISPATCHED'), ('APPROVED', 'CANCELLED'), ('DISPATCHED', 'RECEIVED')
  ) then
    raise exception 'Không thể chuyển yêu cầu điều chuyển từ % sang %.', old.status, new.status;
  end if;
  return new;
end;
$$;

create or replace function private.transfer_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa dòng sản phẩm của yêu cầu điều chuyển.';
  end if;

  if tg_op = 'INSERT' then
    select t.status into v_status from public.transfers t where t.id = new.transfer_id;
    if v_status is distinct from 'REQUESTED' then
      raise exception 'Chỉ thêm được sản phẩm khi yêu cầu điều chuyển còn ở trạng thái REQUESTED.';
    end if;
    if new.batch_id is not null or new.approved_qty <> 0 or new.dispatched_qty <> 0 or new.received_qty <> 0 then
      raise exception 'Dòng của yêu cầu mới chưa được gán lô và chưa có số lượng duyệt, xuất hay nhận.';
    end if;
    return new;
  end if;

  if new.transfer_id is distinct from old.transfer_id
     or new.product_id is distinct from old.product_id
     or new.requested_qty is distinct from old.requested_qty then
    raise exception 'Không được đổi yêu cầu, sản phẩm hay số lượng đề nghị của dòng điều chuyển.';
  end if;
  return new;
end;
$$;

create or replace function private.transfers_no_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Không được xóa toàn bộ dữ liệu điều chuyển.';
end;
$$;

create trigger transfers_guard_write
  before insert or update or delete on public.transfers
  for each row execute function private.transfers_guard();
create trigger transfer_items_guard_write
  before insert or update or delete on public.transfer_items
  for each row execute function private.transfer_items_guard();
create trigger transfers_no_truncate
  before truncate on public.transfers
  for each statement execute function private.transfers_no_truncate();
create trigger transfer_items_no_truncate
  before truncate on public.transfer_items
  for each statement execute function private.transfers_no_truncate();

revoke all on function private.transfers_guard(), private.transfer_items_guard(),
  private.transfers_no_truncate() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Permission: `propose_transfer` (src/domain/auth/roles.ts PERMISSION_MATRIX; parity asserted by an integration test).
-- ---------------------------------------------------------------------------
create or replace function private.can_propose_transfers()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(array['ADMIN', 'SALE_B2B', 'STORE_STAFF', 'FRANCHISE_STAFF', 'WAREHOUSE'])
$$;

revoke all on function private.can_propose_transfers() from public, anon;
grant execute on function private.can_propose_transfers() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Access: Admin reads everything, a requester reads their own requests, lines follow their transfer.
-- Nobody writes these tables directly; the RPC below is the only door.
-- ---------------------------------------------------------------------------
alter table public.transfers enable row level security;
alter table public.transfer_items enable row level security;

revoke all on table public.transfers, public.transfer_items from anon;
revoke insert, update, delete, truncate on table public.transfers, public.transfer_items from authenticated;

create policy transfers_select_admin_or_requester on public.transfers
  for select to authenticated
  using (
    (select private.is_admin())
    or ((select private.is_active_user()) and requested_by = (select auth.uid()))
  );

-- The sub-select is itself subject to the transfers policy above.
create policy transfer_items_select_via_transfer on public.transfer_items
  for select to authenticated
  using (exists (select 1 from public.transfers t where t.id = transfer_id));

create trigger audit_transfers after insert or update on public.transfers
  for each row execute function private.audit_row_change();
create trigger audit_transfer_items after insert or update on public.transfer_items
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- The request operation
--   p_items: [{"product_id": "<uuid>", "quantity": <integer >= 1>}, ...], 1..50 distinct products.
--   Keep the limits identical to MAX_TRANSFER_LINES / MAX_TRANSFER_REASON_LENGTH / MAX_LINE_QUANTITY in
--   src/domain/transfers/transfers.ts.
--   No stock check on purpose: the Admin approval screen shows sellable stock and the safety-stock impact (PRD §B16).
-- ---------------------------------------------------------------------------
create or replace function public.request_transfer(
  p_source_location_id uuid,
  p_destination_location_id uuid,
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
  v_line jsonb;
  v_product uuid;
  v_qty int;
  v_seen uuid[] := '{}';
  v_transfer public.transfers;
begin
  if not private.can_propose_transfers() then
    raise exception 'Bạn không có quyền đề xuất điều chuyển kho.' using errcode = '42501';
  end if;

  if p_source_location_id is null or p_destination_location_id is null then
    raise exception 'Vui lòng chọn kho xuất và kho nhận.';
  end if;
  if p_source_location_id = p_destination_location_id then
    raise exception 'Kho xuất và kho nhận phải khác nhau.';
  end if;
  -- Locked FOR SHARE so a location cannot be closed between this check and the insert.
  perform 1 from public.locations where id = p_source_location_id and is_active for share;
  if not found then
    raise exception 'Kho xuất không tồn tại hoặc đã ngừng sử dụng.';
  end if;
  perform 1 from public.locations where id = p_destination_location_id and is_active for share;
  if not found then
    raise exception 'Kho nhận không tồn tại hoặc đã ngừng sử dụng.';
  end if;

  if v_reason = '' then
    raise exception 'Vui lòng nhập lý do hoặc ghi chú cho yêu cầu điều chuyển.';
  end if;
  if char_length(v_reason) > c_max_reason then
    raise exception 'Lý do tối đa % ký tự.', c_max_reason;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Vui lòng chọn ít nhất một sản phẩm cần chuyển.';
  end if;
  if jsonb_array_length(p_items) > c_max_lines then
    raise exception 'Mỗi yêu cầu có tối đa % sản phẩm.', c_max_lines;
  end if;

  for v_line in select e from jsonb_array_elements(p_items) as t(e) loop
    if jsonb_typeof(v_line -> 'product_id') is distinct from 'string'
       or (v_line ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Dòng sản phẩm không hợp lệ.';
    end if;
    if jsonb_typeof(v_line -> 'quantity') is distinct from 'number'
       or (v_line ->> 'quantity') !~ '^[0-9]{1,9}$' then
      raise exception 'Số lượng phải là số nguyên lớn hơn 0.';
    end if;
    v_product := (v_line ->> 'product_id')::uuid;
    v_qty := (v_line ->> 'quantity')::int;
    if v_qty < 1 then
      raise exception 'Số lượng phải là số nguyên lớn hơn 0.';
    end if;
    if v_product = any (v_seen) then
      raise exception 'Mỗi sản phẩm chỉ được xuất hiện một lần trong yêu cầu.';
    end if;
    v_seen := v_seen || v_product;
    if not exists (select 1 from public.products where id = v_product and is_active) then
      raise exception 'Sản phẩm không tồn tại hoặc đã ngừng kinh doanh.';
    end if;
  end loop;

  perform set_config('app.audit_reason', 'Yêu cầu điều chuyển kho', true);

  insert into public.transfers (transfer_code, requested_by, source_location_id, destination_location_id, reason)
  values ('', (select auth.uid()), p_source_location_id, p_destination_location_id, v_reason)
  returning * into v_transfer;

  insert into public.transfer_items (transfer_id, product_id, requested_qty)
  select v_transfer.id, (t.e ->> 'product_id')::uuid, (t.e ->> 'quantity')::int
  from jsonb_array_elements(p_items) with ordinality as t(e, n)
  order by t.n;

  perform set_config('app.audit_reason', '', true);

  return to_jsonb(v_transfer) || jsonb_build_object('items', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'product_id', i.product_id, 'requested_qty', i.requested_qty) order by i.id), '[]'::jsonb)
    from public.transfer_items i
    where i.transfer_id = v_transfer.id));
end;
$$;

revoke all on function public.request_transfer(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.request_transfer(uuid, uuid, jsonb, text) to authenticated;
