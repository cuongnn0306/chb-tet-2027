-- ORD-001: orders, order_items, status history (TECH_DESIGN §3.9, §3.10, §6; PRD §7, §21).
--
-- Integrity model (AGENTS §4/§5):
--   * Transaction rows are NEVER hard-deleted (no DELETE for anyone, enforced by trigger).
--   * Clients cannot INSERT/UPDATE orders or items directly: every change goes through the
--     validated, atomic RPCs added in the following migrations. Reads are filtered by RLS.
--   * The status machine is enforced here in the database for every caller (client, RPC, service role).
--   * Customer, attribution, items and amounts are frozen once an order leaves DRAFT, so a confirmed
--     order's quantities can never change (change = cancel + new order).
--   * Money is integer VND (bigint).

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  customer_id uuid not null references public.customers (id),
  owner_user_id uuid not null references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  creation_location_id uuid not null references public.locations (id),
  sales_channel_id uuid not null references public.sales_channels (id),
  lead_source_id uuid not null references public.lead_sources (id),
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'WAITING_CONFIRMATION', 'WAITING_DEPOSIT', 'CONFIRMED', 'RESERVED', 'PREPARING',
    'WAITING_DELIVERY', 'COMPLETED', 'CANCELLED', 'VOIDED', 'RETURNED', 'EXCHANGED'
  )),
  gross_amount bigint not null default 0 check (gross_amount >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  net_amount bigint not null default 0 check (net_amount >= 0),
  deposit_required bigint not null default 0 check (deposit_required >= 0),
  paid_amount bigint not null default 0 check (paid_amount >= 0),
  -- Derived so it can never disagree with net/paid. An overpayment shows as 0 remaining.
  remaining_amount bigint generated always as (greatest(net_amount - paid_amount, 0)) stored,
  requires_invoice boolean not null default false,
  notes text,
  reservation_expires_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_net_is_gross_minus_discount check (net_amount = gross_amount - discount_amount),
  constraint orders_voided_has_reason check (
    status <> 'VOIDED' or (voided_at is not null and btrim(coalesce(void_reason, '')) <> '')
  ),
  constraint orders_cancelled_has_timestamp check (status <> 'CANCELLED' or cancelled_at is not null)
);

create index orders_customer_id_idx on public.orders (customer_id);
create index orders_owner_user_id_idx on public.orders (owner_user_id);
create index orders_created_by_idx on public.orders (created_by);
create index orders_status_idx on public.orders (status);
create index orders_created_at_idx on public.orders (created_at desc);
create index orders_location_idx on public.orders (creation_location_id);
create index orders_channel_idx on public.orders (sales_channel_id);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  product_id uuid not null references public.products (id),
  quantity int not null check (quantity > 0),
  -- Snapshot of the product's list price when the line was saved.
  list_price bigint not null check (list_price >= 0),
  gross_line_amount bigint not null check (gross_line_amount >= 0),
  allocated_quantity int not null default 0 check (allocated_quantity >= 0),
  delivered_quantity int not null default 0 check (delivered_quantity >= 0),
  returned_quantity int not null default 0 check (returned_quantity >= 0),
  created_at timestamptz not null default now(),
  constraint order_items_line_amount check (gross_line_amount = list_price * quantity),
  constraint order_items_allocated_within_quantity check (allocated_quantity <= quantity),
  constraint order_items_delivered_within_quantity check (delivered_quantity <= quantity),
  constraint order_items_returned_within_delivered check (returned_quantity <= delivered_quantity),
  constraint order_items_order_product_key unique (order_id, product_id)
);

create index order_items_product_id_idx on public.order_items (product_id);

-- Immutable timeline of status changes (ORD-013). Written only by the trigger below.
create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  from_status text,
  to_status text not null,
  actor_user_id uuid references public.profiles (id),
  reason text,
  created_at timestamptz not null default now()
);

create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

-- ---------------------------------------------------------------------------
-- State machine (TECH_DESIGN §6). Authoritative: enforced for every caller.
-- ---------------------------------------------------------------------------
create or replace function private.is_valid_order_transition(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('DRAFT', 'WAITING_CONFIRMATION'),
    ('WAITING_CONFIRMATION', 'DRAFT'),            -- back to draft while not yet paid
    ('WAITING_CONFIRMATION', 'WAITING_DEPOSIT'),
    ('WAITING_DEPOSIT', 'CONFIRMED'),
    ('CONFIRMED', 'RESERVED'),
    ('RESERVED', 'PREPARING'),
    ('PREPARING', 'WAITING_DELIVERY'),
    ('WAITING_DELIVERY', 'COMPLETED'),
    ('DRAFT', 'CANCELLED'),
    ('WAITING_CONFIRMATION', 'CANCELLED'),
    ('WAITING_DEPOSIT', 'CANCELLED'),
    ('CONFIRMED', 'CANCELLED'),
    ('RESERVED', 'CANCELLED'),
    ('COMPLETED', 'RETURNED'),
    ('COMPLETED', 'EXCHANGED'),
    ('DRAFT', 'VOIDED'),
    ('WAITING_CONFIRMATION', 'VOIDED'),
    ('WAITING_DEPOSIT', 'VOIDED'),
    ('CONFIRMED', 'VOIDED')
  )
$$;

create or replace function private.orders_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa đơn hàng. Hãy hủy hoặc vô hiệu hóa đơn (có lý do và Audit Log).';
  end if;

  if new.order_code is distinct from old.order_code or new.created_by is distinct from old.created_by then
    raise exception 'Không được đổi mã đơn hoặc người tạo đơn.';
  end if;

  if new.status is distinct from old.status
     and not private.is_valid_order_transition(old.status, new.status) then
    raise exception 'Không thể chuyển đơn từ % sang %.', old.status, new.status;
  end if;

  -- Everything that defines "what was sold, to whom, at what price" is frozen after DRAFT.
  if old.status <> 'DRAFT' and (
       new.customer_id is distinct from old.customer_id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.creation_location_id is distinct from old.creation_location_id
    or new.sales_channel_id is distinct from old.sales_channel_id
    or new.lead_source_id is distinct from old.lead_source_id
    or new.gross_amount is distinct from old.gross_amount
    or new.discount_amount is distinct from old.discount_amount
    or new.net_amount is distinct from old.net_amount
  ) then
    raise exception 'Đơn đã gửi/xác nhận không được sửa khách hàng, số lượng hay giá. Hãy hủy đơn cũ và tạo đơn mới.';
  end if;

  return new;
end;
$$;

create trigger orders_guard_update
  before update on public.orders
  for each row execute function private.orders_guard();
create trigger orders_guard_delete
  before delete on public.orders
  for each row execute function private.orders_guard();

-- Lines may only be added/changed/removed while the order is a DRAFT; quantities of a
-- submitted or confirmed order are immutable. Fulfilment counters (allocated/delivered/returned)
-- are the only columns later epics may change after the draft stage.
create or replace function private.order_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order uuid := coalesce(new.order_id, old.order_id);
  v_status text;
begin
  select status into v_status from public.orders where id = v_order;

  if tg_op = 'INSERT' then
    if v_status is distinct from 'DRAFT' then
      raise exception 'Chỉ được thêm sản phẩm khi đơn còn ở trạng thái nháp.';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_status is distinct from 'DRAFT' then
      raise exception 'Đơn đã gửi/xác nhận không được xóa dòng sản phẩm. Hãy hủy đơn cũ và tạo đơn mới.';
    end if;
    return old;
  end if;

  -- UPDATE
  if new.order_id is distinct from old.order_id then
    raise exception 'Không được chuyển dòng sản phẩm sang đơn khác.';
  end if;
  if v_status is distinct from 'DRAFT' and (
       new.product_id is distinct from old.product_id
    or new.quantity is distinct from old.quantity
    or new.list_price is distinct from old.list_price
    or new.gross_line_amount is distinct from old.gross_line_amount
  ) then
    raise exception 'Đơn đã gửi/xác nhận không được sửa số lượng hay giá. Hãy hủy đơn cũ và tạo đơn mới.';
  end if;
  return new;
end;
$$;

create trigger order_items_guard_change
  before insert or update or delete on public.order_items
  for each row execute function private.order_items_guard();

create or replace function private.history_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Lịch sử trạng thái là bất biến: không được sửa hoặc xóa';
end;
$$;

create trigger order_status_history_no_change
  before update or delete on public.order_status_history
  for each row execute function private.history_immutable();
create trigger order_status_history_no_truncate
  before truncate on public.order_status_history
  for each statement execute function private.history_immutable();

-- Record every status change (and the initial status) with who and why.
-- Reason comes from set_config('app.audit_reason', ..., true) inside the same transaction.
create or replace function private.record_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_status_history (order_id, from_status, to_status, actor_user_id, reason)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      (select auth.uid()),
      nullif(current_setting('app.audit_reason', true), '')
    );
  end if;
  return null;
end;
$$;

create trigger orders_record_status
  after insert or update of status on public.orders
  for each row execute function private.record_order_status();

revoke all on function private.orders_guard(), private.order_items_guard(),
  private.history_immutable(), private.record_order_status() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access: read-only for clients. Sales roles see their own orders (owner or creator); Admin sees all.
-- ---------------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;

revoke all on table public.orders, public.order_items, public.order_status_history from anon;
revoke insert, update, delete, truncate on table public.orders, public.order_items,
  public.order_status_history from authenticated;

create policy orders_select_own_or_admin on public.orders
  for select to authenticated
  using (
    (select private.can_create_orders())
    and (
      owner_user_id = (select auth.uid())
      or created_by = (select auth.uid())
      or (select private.is_admin())
    )
  );

-- Lines and history are visible exactly when their order is (the subquery applies orders' RLS).
create policy order_items_select_via_order on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create policy order_status_history_select_via_order on public.order_status_history
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create trigger audit_orders after insert or update or delete on public.orders
  for each row execute function private.audit_row_change();
create trigger audit_order_items after insert or update or delete on public.order_items
  for each row execute function private.audit_row_change();
