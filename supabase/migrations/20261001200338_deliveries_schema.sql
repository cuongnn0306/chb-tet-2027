-- DEL-001..003, DEL-006: deliveries and delivery items (TECH_DESIGN §3.19, §3.20, §7; PRD §16).
-- One order can have several deliveries (delivery batches). The total quantity assigned to
-- deliveries can never exceed the ordered quantity of a line; a cancelled delivery frees its quantity.
-- Deliveries are never deleted (cancel them); items can only be rearranged while PREPARING.
--
-- Delivery method values are not defined in the docs; the PRD says no courier integration in V1:
--   CHB_DELIVERY (CHB tự giao), THIRD_PARTY (đơn vị vận chuyển), CUSTOMER_PICKUP (khách tự đến lấy).

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_code text not null unique,
  order_id uuid not null references public.orders (id),
  scheduled_date date not null,
  scheduled_time time,
  recipient_name text not null check (btrim(recipient_name) <> ''),
  recipient_phone text not null check (btrim(recipient_phone) <> ''),
  delivery_address text,
  source_location_id uuid not null references public.locations (id),
  delivery_method text not null default 'CHB_DELIVERY'
    check (delivery_method in ('CHB_DELIVERY', 'THIRD_PARTY', 'CUSTOMER_PICKUP')),
  shipping_fee bigint not null default 0 check (shipping_fee >= 0),
  shipping_fee_payer text not null default 'CUSTOMER' check (shipping_fee_payer in ('CUSTOMER', 'COMPANY')),
  status text not null default 'PREPARING'
    check (status in ('PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED')),
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  failed_reason text,
  cancelled_reason text,
  -- A pickup needs no address; every other method does.
  constraint deliveries_address_required check (
    delivery_method = 'CUSTOMER_PICKUP' or btrim(coalesce(delivery_address, '')) <> ''
  ),
  constraint deliveries_delivered_has_time check (status <> 'DELIVERED' or delivered_at is not null),
  constraint deliveries_failed_has_reason check (status <> 'FAILED' or btrim(coalesce(failed_reason, '')) <> ''),
  constraint deliveries_cancelled_has_reason check (
    status <> 'CANCELLED' or btrim(coalesce(cancelled_reason, '')) <> ''
  )
);

create index deliveries_order_idx on public.deliveries (order_id);
create index deliveries_schedule_idx on public.deliveries (scheduled_date, status);
create index deliveries_source_idx on public.deliveries (source_location_id);

create trigger deliveries_set_updated_at
  before update on public.deliveries
  for each row execute function public.set_updated_at();

create table public.delivery_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id),
  order_item_id uuid not null references public.order_items (id),
  product_id uuid not null references public.products (id),
  quantity int not null check (quantity > 0),
  batch_id uuid references public.product_batches (id), -- batches actually taken are in the ledger (movements.delivery_id)
  created_at timestamptz not null default now(),
  constraint delivery_items_delivery_item_key unique (delivery_id, order_item_id)
);

create index delivery_items_order_item_idx on public.delivery_items (order_item_id);

-- Trace every stock exit to the delivery that caused it.
alter table public.inventory_movements add column delivery_id uuid references public.deliveries (id);
create index inventory_movements_delivery_idx on public.inventory_movements (delivery_id);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create or replace function private.deliveries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa đợt giao hàng. Hãy hủy đợt giao kèm lý do.';
  end if;

  if tg_op = 'INSERT' then
    -- Code = order code + position of the delivery within the order, e.g. TET000123-02.
    new.delivery_code := (select o.order_code from public.orders o where o.id = new.order_id)
      || '-' || lpad((select count(*) + 1 from public.deliveries d where d.order_id = new.order_id)::text, 2, '0');
    return new;
  end if;

  if new.order_id is distinct from old.order_id or new.delivery_code is distinct from old.delivery_code
     or new.created_at is distinct from old.created_at then
    raise exception 'Không được đổi đơn hay mã của đợt giao.';
  end if;

  if new.status is distinct from old.status and (old.status, new.status) not in (
    ('PREPARING', 'READY'), ('READY', 'OUT_FOR_DELIVERY'), ('OUT_FOR_DELIVERY', 'DELIVERED'),
    ('OUT_FOR_DELIVERY', 'FAILED'), ('FAILED', 'READY'), ('PREPARING', 'CANCELLED'), ('READY', 'CANCELLED')
  ) then
    raise exception 'Không thể chuyển đợt giao từ % sang %.', old.status, new.status;
  end if;

  -- Once the goods left (or the delivery is closed) the plan is frozen.
  if old.status in ('OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED') and (
       new.scheduled_date is distinct from old.scheduled_date or new.scheduled_time is distinct from old.scheduled_time
    or new.recipient_name is distinct from old.recipient_name or new.recipient_phone is distinct from old.recipient_phone
    or new.delivery_address is distinct from old.delivery_address or new.source_location_id is distinct from old.source_location_id
    or new.delivery_method is distinct from old.delivery_method or new.shipping_fee is distinct from old.shipping_fee
    or new.shipping_fee_payer is distinct from old.shipping_fee_payer
  ) then
    raise exception 'Đợt giao đã xuất kho hoặc đã đóng, không được sửa thông tin giao hàng.';
  end if;
  return new;
end;
$$;

create or replace function private.delivery_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items;
  v_delivery public.deliveries;
  v_assigned bigint;
  v_order uuid;
begin
  if tg_op = 'DELETE' then
    select * into v_delivery from public.deliveries where id = old.delivery_id;
    if v_delivery.status <> 'PREPARING' then
      raise exception 'Chỉ sửa được sản phẩm của đợt giao khi đang chuẩn bị.';
    end if;
    return old;
  end if;

  select * into v_delivery from public.deliveries where id = new.delivery_id;
  if tg_op = 'UPDATE' then
    if new.delivery_id is distinct from old.delivery_id or new.order_item_id is distinct from old.order_item_id
       or new.product_id is distinct from old.product_id then
      raise exception 'Không được đổi đợt giao hay dòng sản phẩm của mục giao hàng.';
    end if;
    if v_delivery.status not in ('PREPARING') and new.quantity is distinct from old.quantity then
      raise exception 'Chỉ sửa được số lượng của đợt giao khi đang chuẩn bị.';
    end if;
  elsif v_delivery.status <> 'PREPARING' then
    raise exception 'Chỉ thêm được sản phẩm vào đợt giao khi đang chuẩn bị.';
  end if;

  -- Lock the order line so two deliveries cannot over-assign it at the same time.
  select * into v_item from public.order_items where id = new.order_item_id for update;
  if not found or v_item.order_id <> v_delivery.order_id then
    raise exception 'Dòng sản phẩm không thuộc đơn hàng của đợt giao.';
  end if;
  if v_item.product_id <> new.product_id then
    raise exception 'Sản phẩm không khớp với dòng sản phẩm của đơn.';
  end if;

  select coalesce(sum(di.quantity), 0) into v_assigned
  from public.delivery_items di
  join public.deliveries d on d.id = di.delivery_id
  where di.order_item_id = new.order_item_id and d.status <> 'CANCELLED'
    and di.id is distinct from new.id;

  if v_assigned + new.quantity > v_item.quantity then
    raise exception 'Tổng số lượng các đợt giao (%) vượt số lượng đặt (%). Còn có thể giao thêm %.',
      v_assigned + new.quantity, v_item.quantity, greatest(v_item.quantity - v_assigned, 0)
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger deliveries_guard_write
  before insert or update or delete on public.deliveries
  for each row execute function private.deliveries_guard();
create trigger delivery_items_guard_write
  before insert or update or delete on public.delivery_items
  for each row execute function private.delivery_items_guard();

revoke all on function private.deliveries_guard(), private.delivery_items_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access: planners see their orders' deliveries; Admin and Warehouse see all. Writes only via RPCs.
-- ---------------------------------------------------------------------------
alter table public.deliveries enable row level security;
alter table public.delivery_items enable row level security;

revoke all on table public.deliveries, public.delivery_items from anon;
revoke insert, update, delete, truncate on table public.deliveries, public.delivery_items from authenticated;

create policy deliveries_select on public.deliveries
  for select to authenticated
  using (
    (select private.has_role(array['ADMIN', 'WAREHOUSE']))
    or exists (select 1 from public.orders o where o.id = order_id)
  );

create policy delivery_items_select on public.delivery_items
  for select to authenticated
  using (exists (select 1 from public.deliveries d where d.id = delivery_id));

create trigger audit_deliveries after insert or update on public.deliveries
  for each row execute function private.audit_row_change();
create trigger audit_delivery_items after insert or update or delete on public.delivery_items
  for each row execute function private.audit_row_change();
