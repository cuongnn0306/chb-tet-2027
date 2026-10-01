-- RES-001..010: reservations, FEFO allocation, shortage signal, source suggestions.
-- TECH_DESIGN §3.13, §5.2, §5.3, §6.3–6.5; PRD §8, §9, §12–§14.
--
-- Two separate concepts (PRD §8):
--   TEMPORARY            a hold with a TTL, taken when an Admin confirms an order into WAITING_DEPOSIT.
--                        It expires automatically if the deposit does not arrive.
--   PHYSICAL_ALLOCATION  stock actually set aside for a confirmed order (status RESERVED), picked by FEFO.
-- Confirmed orders that are not allocated yet are only DEMAND COMMITMENT: they feed forecasts and
-- production planning but do not lock stock (see committed_demand()).
--
-- Rules enforced here:
--   * A hold can never exceed what is free: available - reserved (and, unless Admin overrides,
--     never dips into the location's safety stock).
--   * FEFO: earliest expiry first, then earliest manufacture date; only ACTIVE, non-expired batches;
--     one line may be satisfied by several batches.
--   * inventory_balances.reserved_qty is derived from ACTIVE reservations and only changes inside
--     these functions (same guard flag as stock movements); verify_inventory_balances() checks it.
--   * Allocation lead time (setting allocation_lead_days) is read by the delivery-date driven job in E07,
--     when deliveries exist; allocate_order() is the primitive that job (and Admin/Warehouse) call.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  order_item_id uuid not null references public.order_items (id),
  location_id uuid not null references public.locations (id),
  product_id uuid not null references public.products (id),
  batch_id uuid not null references public.product_batches (id),
  quantity int not null check (quantity > 0),
  reservation_type text not null check (reservation_type in ('TEMPORARY', 'PHYSICAL_ALLOCATION')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz,
  released_at timestamptz,
  release_reason text,
  constraint inventory_reservations_ttl check (
    (reservation_type = 'TEMPORARY' and expires_at is not null)
    or (reservation_type = 'PHYSICAL_ALLOCATION' and expires_at is null)
  ),
  constraint inventory_reservations_closed_has_time check (status = 'ACTIVE' or released_at is not null)
);

create index inventory_reservations_order_idx on public.inventory_reservations (order_id);
create index inventory_reservations_order_item_idx on public.inventory_reservations (order_item_id);
create index inventory_reservations_batch_active_idx
  on public.inventory_reservations (location_id, batch_id) where status = 'ACTIVE';
create index inventory_reservations_expiry_idx
  on public.inventory_reservations (expires_at)
  where reservation_type = 'TEMPORARY' and status = 'ACTIVE';

-- Reservations change only inside the engine below (guard flag), never by direct writes.
create or replace function private.inventory_reservations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa bản ghi giữ hàng. Hãy giải phóng hoặc hủy đơn.';
  end if;
  if coalesce(current_setting('app.inventory_posting', true), '') <> 'on' then
    raise exception 'Không được sửa giữ hàng trực tiếp. Hãy dùng chức năng giữ/phân bổ/giải phóng hàng.';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'ACTIVE' then
    raise exception 'Bản ghi giữ hàng đã đóng, không được sửa.';
  end if;
  return new;
end;
$$;

create trigger inventory_reservations_guard_write
  before insert or update or delete on public.inventory_reservations
  for each row execute function private.inventory_reservations_guard();

revoke all on function private.inventory_reservations_guard() from public, anon, authenticated;

alter table public.inventory_reservations enable row level security;
revoke all on table public.inventory_reservations from anon;
revoke insert, update, delete, truncate on table public.inventory_reservations from authenticated;

-- Visible to whoever can see the order, plus Admin and Warehouse (they prepare the stock).
create policy inventory_reservations_select on public.inventory_reservations
  for select to authenticated
  using (
    (select private.has_role(array['ADMIN', 'WAREHOUSE']))
    or exists (select 1 from public.orders o where o.id = order_id)
  );

create trigger audit_inventory_reservations
  after insert or update on public.inventory_reservations
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Stock a location can still sell for a product: (available - reserved) of ACTIVE, non-expired
-- batches, minus its safety stock, never below zero (same rule as inventory_summary()).
create or replace function private.sellable_qty(p_location_id uuid, p_product_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((
      select sum(b.available_qty - b.reserved_qty)
      from public.inventory_balances b
      join public.product_batches pb on pb.id = b.batch_id
      where b.location_id = p_location_id and b.product_id = p_product_id
        and pb.status = 'ACTIVE' and pb.expiry_date >= private.business_today()
    ), 0)
    - coalesce((
      select r.minimum_qty from public.safety_stock_rules r
      where r.location_id = p_location_id and r.product_id = p_product_id
    ), 0),
    0
  )::int
$$;

-- ---------------------------------------------------------------------------
-- Engine: reserve (FEFO), release, expire
-- ---------------------------------------------------------------------------
create or replace function private.reserve_order_stock(
  p_order_id uuid,
  p_type text,
  p_expires_at timestamptz default null,
  p_allow_below_safety boolean default false,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_item record;
  v_bal record;
  v_loc uuid;
  v_today date := private.business_today();
  v_need int;
  v_usable int;
  v_safety int;
  v_quota int;
  v_take int;
  v_taken int;
  v_lines jsonb := '[]'::jsonb;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Không tìm thấy đơn hàng.';
  end if;
  if p_type not in ('TEMPORARY', 'PHYSICAL_ALLOCATION') then
    raise exception 'Loại giữ hàng không hợp lệ.';
  end if;
  v_loc := coalesce(p_location_id, v_order.creation_location_id);

  perform set_config('app.inventory_posting', 'on', true);

  for v_item in select * from public.order_items where order_id = p_order_id order by product_id loop
    if p_type = 'TEMPORARY' then
      v_need := v_item.quantity - coalesce((
        select sum(r.quantity) from public.inventory_reservations r
        where r.order_item_id = v_item.id and r.status = 'ACTIVE' and r.reservation_type = 'TEMPORARY'), 0);
    else
      v_need := v_item.quantity - v_item.allocated_quantity;
    end if;
    v_taken := 0;

    if v_need > 0 then
      -- Lock the candidate balance rows in FEFO order (also the lock order of every other reserver).
      perform 1
      from public.inventory_balances b
      join public.product_batches pb on pb.id = b.batch_id
      where b.location_id = v_loc and b.product_id = v_item.product_id
        and pb.status = 'ACTIVE' and pb.expiry_date >= v_today
      order by pb.expiry_date, pb.manufactured_date, pb.id
      for update of b;

      select coalesce(sum(b.available_qty - b.reserved_qty), 0)::int into v_usable
      from public.inventory_balances b
      join public.product_batches pb on pb.id = b.batch_id
      where b.location_id = v_loc and b.product_id = v_item.product_id
        and pb.status = 'ACTIVE' and pb.expiry_date >= v_today;

      select coalesce(r.minimum_qty, 0) into v_safety from public.safety_stock_rules r
      where r.location_id = v_loc and r.product_id = v_item.product_id;
      v_safety := coalesce(v_safety, 0);

      v_quota := least(v_need, case when p_allow_below_safety then v_usable else greatest(v_usable - v_safety, 0) end);

      for v_bal in
        select b.id as balance_id, b.batch_id, (b.available_qty - b.reserved_qty) as free_qty
        from public.inventory_balances b
        join public.product_batches pb on pb.id = b.batch_id
        where b.location_id = v_loc and b.product_id = v_item.product_id
          and pb.status = 'ACTIVE' and pb.expiry_date >= v_today
          and b.available_qty - b.reserved_qty > 0
        order by pb.expiry_date, pb.manufactured_date, pb.id
      loop
        exit when v_quota <= 0;
        v_take := least(v_bal.free_qty, v_quota);
        update public.inventory_balances set reserved_qty = reserved_qty + v_take where id = v_bal.balance_id;
        insert into public.inventory_reservations (
          order_id, order_item_id, location_id, product_id, batch_id, quantity, reservation_type, expires_at
        ) values (
          p_order_id, v_item.id, v_loc, v_item.product_id, v_bal.batch_id, v_take, p_type,
          case when p_type = 'TEMPORARY' then p_expires_at end
        );
        v_quota := v_quota - v_take;
        v_taken := v_taken + v_take;
      end loop;

      if p_type = 'PHYSICAL_ALLOCATION' and v_taken > 0 then
        update public.order_items set allocated_quantity = allocated_quantity + v_taken where id = v_item.id;
      end if;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'order_item_id', v_item.id, 'product_id', v_item.product_id, 'quantity', v_item.quantity,
      'requested', greatest(v_need, 0), 'reserved_now', v_taken,
      'shortage', greatest(v_need, 0) - v_taken
    );
  end loop;

  perform set_config('app.inventory_posting', 'off', true);
  return jsonb_build_object('location_id', v_loc, 'lines', v_lines);
end;
$$;

-- Closes ACTIVE reservations of an order (optionally one type) and frees the cached reserved quantity.
create or replace function private.release_order_reservations(
  p_order_id uuid,
  p_status text,
  p_reason text,
  p_type text default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res record;
  v_count int := 0;
begin
  if p_status not in ('RELEASED', 'EXPIRED', 'CONSUMED') then
    raise exception 'Trạng thái đóng giữ hàng không hợp lệ.';
  end if;
  perform set_config('app.inventory_posting', 'on', true);

  for v_res in
    select * from public.inventory_reservations
    where order_id = p_order_id and status = 'ACTIVE' and (p_type is null or reservation_type = p_type)
    order by id
    for update
  loop
    update public.inventory_balances set reserved_qty = reserved_qty - v_res.quantity
    where location_id = v_res.location_id and product_id = v_res.product_id and batch_id = v_res.batch_id;

    update public.inventory_reservations
    set status = p_status, released_at = now(), release_reason = p_reason
    where id = v_res.id;

    if v_res.reservation_type = 'PHYSICAL_ALLOCATION' then
      update public.order_items set allocated_quantity = allocated_quantity - v_res.quantity
      where id = v_res.order_item_id;
    end if;
    v_count := v_count + 1;
  end loop;

  perform set_config('app.inventory_posting', 'off', true);
  return v_count;
end;
$$;

-- RES-003: release temporary holds whose TTL has passed. Run every minute by pg_cron (below) and
-- before any new reservation. The order stays in WAITING_DEPOSIT (TECH_DESIGN §5.3).
create or replace function private.expire_temporary_reservations(p_as_of timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_total int := 0;
begin
  for v_order in
    select distinct order_id from public.inventory_reservations
    where reservation_type = 'TEMPORARY' and status = 'ACTIVE' and expires_at <= p_as_of
  loop
    v_total := v_total + private.release_order_reservations(
      v_order, 'EXPIRED', 'Hết thời gian giữ hàng tạm, chưa nhận được tiền cọc', 'TEMPORARY');
    update public.orders set reservation_expires_at = null where id = v_order;
  end loop;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Order lifecycle hooks (state machine is authoritative in the database)
--   -> WAITING_DEPOSIT      temporary hold with TTL (setting reservation_ttl_hours, must be configured)
--   -> CONFIRMED            deposit met: the hold is replaced by demand commitment (E06 drives this)
--   -> CANCELLED / VOIDED   every hold is released
-- ---------------------------------------------------------------------------
create or replace function private.orders_reservation_hooks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl text;
  v_expires timestamptz;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  if new.status = 'WAITING_DEPOSIT' then
    select value #>> '{}' into v_ttl from public.app_settings where key = 'reservation_ttl_hours';
    if v_ttl is null then
      raise exception 'Chưa cấu hình thời gian giữ hàng tạm. Admin vui lòng thiết lập "Thời gian giữ hàng tạm" trong Cấu hình hệ thống.'
        using errcode = 'P0001';
    end if;
    perform private.expire_temporary_reservations();
    v_expires := now() + (v_ttl::int * interval '1 hour');
    perform private.reserve_order_stock(new.id, 'TEMPORARY', v_expires);
    update public.orders set reservation_expires_at = v_expires where id = new.id;

  elsif new.status = 'CONFIRMED' then
    perform private.release_order_reservations(
      new.id, 'RELEASED', 'Đơn đã xác nhận: chuyển sang nhu cầu cam kết, chờ phân bổ hàng', 'TEMPORARY');
    update public.orders set reservation_expires_at = null where id = new.id;

  elsif new.status in ('CANCELLED', 'VOIDED') then
    perform private.release_order_reservations(
      new.id, 'RELEASED', coalesce(new.cancel_reason, new.void_reason, 'Đơn đã bị hủy'));
    update public.orders set reservation_expires_at = null where id = new.id;
  end if;
  return null;
end;
$$;

create trigger orders_reservation_hooks
  after update of status on public.orders
  for each row execute function private.orders_reservation_hooks();

revoke all on function private.sellable_qty(uuid, uuid), private.reserve_order_stock(uuid, text, timestamptz, boolean, uuid),
  private.release_order_reservations(uuid, text, text, text), private.expire_temporary_reservations(timestamptz),
  private.orders_reservation_hooks() from public, anon, authenticated;
grant execute on function private.sellable_qty(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RES-010: where could missing stock come from? (also the base of the transfer recommendation, TRF-002)
-- Priority (PRD §14): same region, enough quantity, earlier expiry, fewer splits.
-- Only stock that is truly sellable at the source counts, so safety stock is never broken.
-- ---------------------------------------------------------------------------
create or replace function private.transfer_sources(p_product_id uuid, p_destination_id uuid, p_needed int)
returns table (
  location_id uuid,
  location_code text,
  location_name text,
  region text,
  sellable_qty int,
  same_region boolean,
  covers_all boolean,
  earliest_expiry date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.id, l.code, l.name, l.region,
    private.sellable_qty(l.id, p_product_id),
    l.region is not null and l.region = d.region,
    private.sellable_qty(l.id, p_product_id) >= p_needed,
    (select min(pb.expiry_date)
       from public.inventory_balances b join public.product_batches pb on pb.id = b.batch_id
      where b.location_id = l.id and b.product_id = p_product_id
        and pb.status = 'ACTIVE' and pb.expiry_date >= private.business_today()
        and b.available_qty - b.reserved_qty > 0)
  from public.locations l
  cross join (select region from public.locations where id = p_destination_id) d
  where l.is_active and l.id <> p_destination_id
    and private.sellable_qty(l.id, p_product_id) > 0
  order by
    (l.region is not null and l.region = d.region) desc,
    (private.sellable_qty(l.id, p_product_id) >= p_needed) desc,
    5 asc nulls last,
    private.sellable_qty(l.id, p_product_id) desc,
    l.code
$$;

-- Shortage check for lines (qty, already covered by holds) at a location, with source suggestions.
create or replace function private.stock_check_lines(p_location_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_line jsonb;
  v_out jsonb := '[]'::jsonb;
  v_product uuid;
  v_qty int;
  v_covered int;
  v_sellable int;
  v_short int;
  v_suggestions jsonb;
begin
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_product := (v_line ->> 'product_id')::uuid;
    v_qty := (v_line ->> 'quantity')::int;
    v_covered := coalesce((v_line ->> 'covered')::int, 0);
    v_sellable := private.sellable_qty(p_location_id, v_product);
    v_short := greatest(v_qty - v_covered - v_sellable, 0);

    v_suggestions := '[]'::jsonb;
    if v_short > 0 then
      select coalesce(jsonb_agg(jsonb_build_object(
        'location_id', s.location_id, 'code', s.location_code, 'name', s.location_name,
        'sellable_qty', s.sellable_qty, 'same_region', s.same_region, 'covers_all', s.covers_all)), '[]'::jsonb)
      into v_suggestions
      from (select * from private.transfer_sources(v_product, p_location_id, v_short) limit 3) s;
    end if;

    v_out := v_out || (v_line || jsonb_build_object(
      'sellable_now', v_sellable, 'shortage', v_short, 'suggestions', v_suggestions));
  end loop;
  return v_out;
end;
$$;

revoke all on function private.transfer_sources(uuid, uuid, int), private.stock_check_lines(uuid, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------
-- Before an order exists: is there enough sellable stock at the chosen location? (order form warning)
create or replace function public.check_stock(p_location_id uuid, p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.can_create_orders() or private.has_role(array['WAREHOUSE'])) then
    raise exception 'Bạn không có quyền kiểm tra tồn kho.' using errcode = '42501';
  end if;
  perform private.assert_location_active(p_location_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Danh sách sản phẩm không hợp lệ.';
  end if;
  return private.stock_check_lines(p_location_id, (
    select coalesce(jsonb_agg(jsonb_build_object('product_id', t.pid, 'quantity', t.qty)), '[]'::jsonb)
    from (
      select (e ->> 'product_id')::uuid as pid, sum((e ->> 'quantity')::int) as qty
      from jsonb_array_elements(p_items) e
      group by 1
    ) t
  ));
end;
$$;

-- RES-009: stock situation of an existing order (what is held, what is missing, where to get it).
create or replace function public.order_stock_status(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_uid uuid := (select auth.uid());
  v_location uuid;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found
     or not (private.has_role(array['ADMIN', 'WAREHOUSE'])
             or (private.can_create_orders() and (v_order.owner_user_id = v_uid or v_order.created_by = v_uid))) then
    raise exception 'Không tìm thấy đơn hàng hoặc bạn không có quyền xem.';
  end if;

  v_location := coalesce(
    (select r.location_id from public.inventory_reservations r
      where r.order_id = p_order_id and r.status = 'ACTIVE' order by r.reserved_at limit 1),
    v_order.creation_location_id);

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', v_order.status,
    'location_id', v_location,
    'reservation_expires_at', v_order.reservation_expires_at,
    'lines', private.stock_check_lines(v_location, (
      select coalesce(jsonb_agg(jsonb_build_object(
        'order_item_id', i.id, 'product_id', i.product_id, 'sku', p.sku, 'name', p.name,
        'quantity', i.quantity,
        'temp_reserved', coalesce((select sum(r.quantity) from public.inventory_reservations r
          where r.order_item_id = i.id and r.status = 'ACTIVE' and r.reservation_type = 'TEMPORARY'), 0),
        'allocated', i.allocated_quantity,
        'covered', coalesce((select sum(r.quantity) from public.inventory_reservations r
          where r.order_item_id = i.id and r.status = 'ACTIVE'), 0)
      ) order by p.sku), '[]'::jsonb)
      from public.order_items i join public.products p on p.id = i.product_id
      where i.order_id = p_order_id
    ))
  );
end;
$$;

-- RES-007 / RES-008: physical allocation (Admin or Warehouse), FEFO across batches.
-- A temporary hold is replaced by the physical allocation. When every line is fully allocated the
-- order moves CONFIRMED -> RESERVED; otherwise it stays CONFIRMED and the shortage is returned.
create or replace function public.allocate_order(
  p_order_id uuid,
  p_location_id uuid default null,
  p_allow_below_safety boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_result jsonb;
  v_short int;
begin
  if not private.has_role(array['ADMIN', 'WAREHOUSE']) then
    raise exception 'Chỉ Admin hoặc Kho được phân bổ hàng cho đơn.' using errcode = '42501';
  end if;
  if p_allow_below_safety and not private.is_admin() then
    raise exception 'Chỉ Admin được phép dùng tồn an toàn.' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Không tìm thấy đơn hàng.';
  end if;
  if v_order.status <> 'CONFIRMED' then
    raise exception 'Chỉ phân bổ hàng cho đơn đã xác nhận (hiện là %).', v_order.status;
  end if;
  if p_location_id is not null then
    perform private.assert_location_active(p_location_id);
  end if;

  perform private.expire_temporary_reservations();
  perform private.release_order_reservations(p_order_id, 'RELEASED', 'Thay bằng phân bổ hàng', 'TEMPORARY');
  v_result := private.reserve_order_stock(p_order_id, 'PHYSICAL_ALLOCATION', null, p_allow_below_safety, p_location_id);

  select coalesce(sum((l ->> 'shortage')::int), 0) into v_short from jsonb_array_elements(v_result -> 'lines') l;
  if v_short = 0 then
    perform set_config('app.audit_reason', 'Đã phân bổ đủ hàng theo FEFO', true);
    update public.orders set status = 'RESERVED' where id = p_order_id;
    perform set_config('app.audit_reason', '', true);
  end if;

  return v_result || jsonb_build_object('fully_allocated', v_short = 0, 'shortage_total', v_short);
end;
$$;

-- RES-004: demand commitment = confirmed orders not yet physically allocated (feeds production and forecast).
create or replace function public.committed_demand()
returns table (product_id uuid, order_count int, committed_qty bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['ADMIN', 'WAREHOUSE', 'PRODUCTION']) then
    raise exception 'Bạn không có quyền xem nhu cầu cam kết.' using errcode = '42501';
  end if;
  return query
  select i.product_id, count(distinct o.id)::int, sum(i.quantity - i.allocated_quantity)::bigint
  from public.orders o
  join public.order_items i on i.order_id = o.id
  where o.status = 'CONFIRMED' and i.quantity > i.allocated_quantity
  group by i.product_id
  order by i.product_id;
end;
$$;

-- RES-010 as an RPC for the order form and (later) the transfer request screen.
create or replace function public.suggest_transfer_sources(p_product_id uuid, p_destination_location_id uuid, p_quantity int)
returns table (
  location_id uuid, location_code text, location_name text, region text,
  sellable_qty int, same_region boolean, covers_all boolean, earliest_expiry date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.can_create_orders() or private.has_role(array['WAREHOUSE'])) then
    raise exception 'Bạn không có quyền xem gợi ý chuyển kho.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Số lượng phải lớn hơn 0.';
  end if;
  return query select * from private.transfer_sources(p_product_id, p_destination_location_id, p_quantity);
end;
$$;

-- Admin tool: release holds that already passed their TTL right now (the job does this every minute).
create or replace function public.release_expired_reservations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Chỉ Admin được chạy giải phóng hàng quá hạn.' using errcode = '42501';
  end if;
  return private.expire_temporary_reservations();
end;
$$;

revoke all on function public.check_stock(uuid, jsonb), public.order_stock_status(uuid),
  public.allocate_order(uuid, uuid, boolean), public.committed_demand(),
  public.suggest_transfer_sources(uuid, uuid, int), public.release_expired_reservations() from public, anon;
grant execute on function public.check_stock(uuid, jsonb), public.order_stock_status(uuid),
  public.allocate_order(uuid, uuid, boolean), public.committed_demand(),
  public.suggest_transfer_sources(uuid, uuid, int), public.release_expired_reservations() to authenticated;

-- ---------------------------------------------------------------------------
-- Reconciliation now also proves reserved_qty = sum of ACTIVE reservations
-- ---------------------------------------------------------------------------
create or replace function public.verify_inventory_balances()
returns table (
  location_id uuid,
  product_id uuid,
  batch_id uuid,
  column_name text,
  cached_qty int,
  ledger_qty bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Chỉ Admin được đối chiếu tồn kho.' using errcode = '42501';
  end if;

  return query
  with effects as (
    select m.from_location_id as location_id, m.product_id, m.batch_id,
      -m.quantity as d_available,
      0 as d_in_transfer, 0 as d_pending,
      case when m.movement_type = 'DAMAGE_OUT' then m.quantity else 0 end as d_damaged,
      case when m.movement_type = 'SAMPLE_OUT' then m.quantity else 0 end as d_sample,
      case when m.movement_type = 'GIFT_OUT' then m.quantity else 0 end as d_gift
    from public.inventory_movements m
    where m.movement_type in ('SALE_OUT', 'DAMAGE_OUT', 'SAMPLE_OUT', 'GIFT_OUT', 'ADJUSTMENT_OUT', 'TRANSFER_OUT')
    union all
    select m.to_location_id, m.product_id, m.batch_id,
      case when m.movement_type in ('PRODUCTION_IN', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'INSPECTION_TO_AVAILABLE')
           then m.quantity else 0 end,
      case m.movement_type when 'TRANSFER_OUT' then m.quantity when 'TRANSFER_IN' then -m.quantity else 0 end,
      case m.movement_type when 'RETURN_IN' then m.quantity
           when 'INSPECTION_TO_AVAILABLE' then -m.quantity when 'INSPECTION_TO_DAMAGED' then -m.quantity else 0 end,
      case when m.movement_type = 'INSPECTION_TO_DAMAGED' then m.quantity else 0 end,
      0, 0
    from public.inventory_movements m
    where m.to_location_id is not null
  ),
  ledger as (
    select e.location_id, e.product_id, e.batch_id,
      sum(e.d_available) as available, sum(e.d_in_transfer) as in_transfer, sum(e.d_pending) as pending,
      sum(e.d_damaged) as damaged, sum(e.d_sample) as sample, sum(e.d_gift) as gift
    from effects e
    group by e.location_id, e.product_id, e.batch_id
  ),
  held as (
    select r.location_id, r.product_id, r.batch_id, sum(r.quantity) as reserved
    from public.inventory_reservations r
    where r.status = 'ACTIVE'
    group by r.location_id, r.product_id, r.batch_id
  ),
  keys as (
    select b.location_id, b.product_id, b.batch_id from public.inventory_balances b
    union select l.location_id, l.product_id, l.batch_id from ledger l
    union select h.location_id, h.product_id, h.batch_id from held h
  ),
  compared as (
    select k.location_id, k.product_id, k.batch_id, c.name, c.cached, c.ledger
    from keys k
    left join public.inventory_balances b
      on b.location_id = k.location_id and b.product_id = k.product_id and b.batch_id = k.batch_id
    left join ledger l
      on l.location_id = k.location_id and l.product_id = k.product_id and l.batch_id = k.batch_id
    left join held h
      on h.location_id = k.location_id and h.product_id = k.product_id and h.batch_id = k.batch_id
    cross join lateral (values
      ('available_qty', coalesce(b.available_qty, 0), coalesce(l.available, 0)),
      ('in_transfer_qty', coalesce(b.in_transfer_qty, 0), coalesce(l.in_transfer, 0)),
      ('pending_inspection_qty', coalesce(b.pending_inspection_qty, 0), coalesce(l.pending, 0)),
      ('damaged_qty', coalesce(b.damaged_qty, 0), coalesce(l.damaged, 0)),
      ('sample_qty', coalesce(b.sample_qty, 0), coalesce(l.sample, 0)),
      ('gift_qty', coalesce(b.gift_qty, 0), coalesce(l.gift, 0)),
      ('reserved_qty', coalesce(b.reserved_qty, 0), coalesce(h.reserved, 0))
    ) as c(name, cached, ledger)
  )
  select x.location_id, x.product_id, x.batch_id, x.name, x.cached::int, x.ledger::bigint
  from compared x
  where x.cached <> x.ledger;
end;
$$;

-- ---------------------------------------------------------------------------
-- RES-003: schedule the expiry job every minute when pg_cron is available (Supabase has it).
-- Wrapped so the migration still applies on a database without the extension; the job's function
-- is also run lazily before every new reservation, and by Admin via release_expired_reservations().
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'expire-temporary-reservations';
    perform cron.schedule('expire-temporary-reservations', '* * * * *', 'select private.expire_temporary_reservations()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end;
$$;
