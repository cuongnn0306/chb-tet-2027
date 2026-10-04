-- DEL-005 / RV-06: physical allocation per delivery, per order line, per source location.
-- TECH_DESIGN §3.19/§3.20/§5.2/§7; PRD §16 (each delivery records its source warehouse and SKU quantity).
--
-- Problem (review RV-06): allocate_order() allocates the whole order at ONE location and only while the
-- order is CONFIRMED. A delivery planned from another warehouse (or planned after the order became
-- RESERVED / PREPARING / WAITING_DELIVERY, or after a partial delivery) had no way to get stock reserved
-- at its own source, and re-running the order-wide allocation would have re-reserved the quantity that
-- was already delivered.
--
-- This migration is ADDITIVE: no existing RPC contract, table or migration is changed. It adds
--   * delivery_stock_allocations   what was reserved *for* a delivery (append-only bookkeeping),
--   * allocate_delivery_stock()    Admin/Warehouse: reserve exactly one delivery's gap at its source,
--   * delivery_allocation_status() Admin/Warehouse: coverage, shortage and holds at other locations,
--   and replaces the private binder so a later reservation cannot disturb goods already in logistics.
--
-- Accounting model (all per order line x source location):
--   reserved   ACTIVE PHYSICAL_ALLOCATION units held at the location (the real hold; ledger untouched).
--   claim      quantity of every OPEN delivery (not DELIVERED / CANCELLED) from that location.
--   attributed units reserved on behalf of a delivery by allocate_delivery_stock().
--   pool       reserved - sum(attributed): units held by the order-wide allocation (allocate_order).
--              The pool covers open deliveries in priority order (goods already in logistics first, then
--              date/time/creation), so an order that was fully allocated at its creation location still
--              covers deliveries from that location and nothing is reserved twice.
--   gap        claim - attributed - pool share: the only thing allocate_delivery_stock() ever reserves.
--   After a successful allocation, units reserved at OTHER locations for the same order line beyond
--   (remaining to deliver = quantity - delivered_quantity) are released, never units that an open
--   delivery there needs and never a batch already bound to goods in logistics.
-- SALE_OUT still happens only at DELIVERED (unchanged); nothing here posts a stock movement.

-- ---------------------------------------------------------------------------
-- Table: reservations made on behalf of a delivery (never updated, never deleted)
-- ---------------------------------------------------------------------------
create table public.delivery_stock_allocations (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id),
  order_item_id uuid not null references public.order_items (id),
  location_id uuid not null references public.locations (id),
  quantity int not null check (quantity > 0),
  allocated_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index delivery_stock_allocations_delivery_idx
  on public.delivery_stock_allocations (delivery_id, order_item_id);

create or replace function private.delivery_stock_allocations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Không được sửa hoặc xóa bản ghi phân bổ hàng của đợt giao.';
  end if;
  if coalesce(current_setting('app.inventory_posting', true), '') <> 'on' then
    raise exception 'Chỉ chức năng phân bổ hàng cho đợt giao được ghi bản ghi này.';
  end if;
  return new;
end;
$$;

create trigger delivery_stock_allocations_guard_write
  before insert or update or delete on public.delivery_stock_allocations
  for each row execute function private.delivery_stock_allocations_guard();

revoke all on function private.delivery_stock_allocations_guard() from public, anon, authenticated;

alter table public.delivery_stock_allocations enable row level security;
revoke all on table public.delivery_stock_allocations from anon;
revoke insert, update, delete, truncate on table public.delivery_stock_allocations from authenticated;

-- Only the people who prepare the stock see it; Sales never do.
create policy delivery_stock_allocations_select on public.delivery_stock_allocations
  for select to authenticated
  using ((select private.has_role(array['ADMIN', 'WAREHOUSE'])));

create trigger audit_delivery_stock_allocations after insert on public.delivery_stock_allocations
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Accounting helpers
-- ---------------------------------------------------------------------------
create or replace function private.reserved_physical_qty(p_order_item_id uuid, p_location_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.quantity), 0)::int
  from public.inventory_reservations r
  where r.order_item_id = p_order_item_id and r.location_id = p_location_id
    and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'
$$;

-- Quantity of every open delivery of the line that leaves from the location.
create or replace function private.delivery_open_qty(p_order_item_id uuid, p_location_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(di.quantity), 0)::int
  from public.delivery_items di
  join public.deliveries d on d.id = di.delivery_id
  where di.order_item_id = p_order_item_id and d.source_location_id = p_location_id
    and d.status not in ('DELIVERED', 'CANCELLED')
$$;

-- Units of one batch already committed (DEL-011 binding) to goods of other deliveries still in logistics.
create or replace function private.bound_batch_qty(
  p_order_item_id uuid,
  p_location_id uuid,
  p_batch_id uuid,
  p_exclude_delivery uuid default null
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(dib.quantity), 0)::int
  from public.delivery_item_batches dib
  join public.delivery_items di on di.id = dib.delivery_item_id
  join public.deliveries d on d.id = di.delivery_id
  where di.order_item_id = p_order_item_id and d.source_location_id = p_location_id
    and dib.batch_id = p_batch_id
    and d.dispatched_at is not null and d.status not in ('DELIVERED', 'CANCELLED')
    and d.id is distinct from p_exclude_delivery
$$;

-- Coverage of every open delivery of a line at a location (see the model at the top of this file).
create or replace function private.delivery_stock_coverage(p_order_item_id uuid, p_location_id uuid)
returns table (delivery_id uuid, quantity int, attributed int, pool_share int, covered int, gap int)
language sql
stable
security definer
set search_path = ''
as $$
  with open_d as (
    select d.id as delivery_id, di.quantity,
      least(di.quantity, coalesce((
        select sum(a.quantity) from public.delivery_stock_allocations a
        where a.delivery_id = d.id and a.order_item_id = di.order_item_id and a.location_id = p_location_id
      ), 0))::int as attributed,
      row_number() over (
        order by (d.dispatched_at is null), d.scheduled_date, d.scheduled_time nulls last, d.created_at, d.id
      ) as prio
    from public.delivery_items di
    join public.deliveries d on d.id = di.delivery_id
    where di.order_item_id = p_order_item_id and d.source_location_id = p_location_id
      and d.status not in ('DELIVERED', 'CANCELLED')
  ),
  pool as (
    select greatest(
      private.reserved_physical_qty(p_order_item_id, p_location_id) - coalesce(sum(o.attributed), 0), 0
    )::int as qty
    from open_d o
  ),
  waterfall as (
    select o.delivery_id, o.quantity, o.attributed,
      (o.quantity - o.attributed) as deficit,
      coalesce(sum(o.quantity - o.attributed) over (
        order by o.prio rows between unbounded preceding and 1 preceding
      ), 0) as ahead
    from open_d o
  ),
  shares as (
    select w.delivery_id, w.quantity, w.attributed,
      least(w.deficit, greatest((select p.qty from pool p) - w.ahead, 0))::int as pool_share
    from waterfall w
  )
  select s.delivery_id, s.quantity, s.attributed, s.pool_share,
    (s.attributed + s.pool_share)::int, (s.quantity - s.attributed - s.pool_share)::int
  from shares s
$$;

-- Units reserved at a location that no open delivery from there needs and that are not bound to goods
-- already in logistics: the only units a re-allocation elsewhere may take back.
create or replace function private.releasable_surplus_qty(p_order_item_id uuid, p_location_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select least(
    greatest(
      private.reserved_physical_qty(p_order_item_id, p_location_id)
        - private.delivery_open_qty(p_order_item_id, p_location_id), 0),
    coalesce((
      select sum(greatest(b.reserved - private.bound_batch_qty(p_order_item_id, p_location_id, b.batch_id), 0))
      from (
        select r.batch_id, sum(r.quantity)::int as reserved
        from public.inventory_reservations r
        where r.order_item_id = p_order_item_id and r.location_id = p_location_id
          and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'
        group by r.batch_id
      ) b
    ), 0)
  )::int
$$;

-- What a location can still set aside for a product (FEFO-eligible, optionally dipping into safety stock).
-- Locks the candidate balance rows in FEFO order (the lock order of every other reserver), so the number
-- stays true for the rest of the caller's transaction.
create or replace function private.stock_quota(
  p_location_id uuid,
  p_product_id uuid,
  p_allow_below_safety boolean
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_today();
  v_usable int;
  v_safety int;
begin
  perform 1
  from public.inventory_balances b
  join public.product_batches pb on pb.id = b.batch_id
  where b.location_id = p_location_id and b.product_id = p_product_id
    and pb.status = 'ACTIVE' and pb.expiry_date >= v_today
  order by pb.expiry_date, pb.manufactured_date, pb.id
  for update of b;

  select coalesce(sum(b.available_qty - b.reserved_qty), 0)::int into v_usable
  from public.inventory_balances b
  join public.product_batches pb on pb.id = b.batch_id
  where b.location_id = p_location_id and b.product_id = p_product_id
    and pb.status = 'ACTIVE' and pb.expiry_date >= v_today;

  select r.minimum_qty into v_safety from public.safety_stock_rules r
  where r.location_id = p_location_id and r.product_id = p_product_id;

  return case when p_allow_below_safety then v_usable else greatest(v_usable - coalesce(v_safety, 0), 0) end;
end;
$$;

-- Reserve up to p_qty units of one order line at one location by FEFO (same rules as the order-wide
-- engine: ACTIVE, non-expired batches; never below safety stock unless Admin allowed it). Returns what
-- was reserved. Only touches the balances/reservations cache through the posting gate flag.
create or replace function private.reserve_line_stock(
  p_order_item_id uuid,
  p_location_id uuid,
  p_qty int,
  p_allow_below_safety boolean
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items;
  v_today date := private.business_today();
  v_target int;
  v_left int;
  v_take int;
  v_bal record;
begin
  select * into v_item from public.order_items where id = p_order_item_id;
  v_target := least(p_qty, private.stock_quota(p_location_id, v_item.product_id, p_allow_below_safety));
  if v_target <= 0 then
    return 0;
  end if;
  v_left := v_target;

  perform set_config('app.inventory_posting', 'on', true);
  for v_bal in
    select b.id as balance_id, b.batch_id, (b.available_qty - b.reserved_qty) as free_qty
    from public.inventory_balances b
    join public.product_batches pb on pb.id = b.batch_id
    where b.location_id = p_location_id and b.product_id = v_item.product_id
      and pb.status = 'ACTIVE' and pb.expiry_date >= v_today
      and b.available_qty - b.reserved_qty > 0
    order by pb.expiry_date, pb.manufactured_date, pb.id
  loop
    exit when v_left <= 0;
    v_take := least(v_bal.free_qty, v_left);
    update public.inventory_balances set reserved_qty = reserved_qty + v_take where id = v_bal.balance_id;
    insert into public.inventory_reservations (
      order_id, order_item_id, location_id, product_id, batch_id, quantity, reservation_type
    ) values (
      v_item.order_id, p_order_item_id, p_location_id, v_item.product_id, v_bal.batch_id, v_take, 'PHYSICAL_ALLOCATION'
    );
    v_left := v_left - v_take;
  end loop;
  update public.order_items set allocated_quantity = allocated_quantity + (v_target - v_left)
  where id = p_order_item_id;
  perform set_config('app.inventory_posting', 'off', true);
  return v_target - v_left;
end;
$$;

-- Give back p_qty units of an order line held at a location, latest expiry first, never a batch that is
-- already bound to goods in logistics. Reservations are closed (RELEASED), never deleted; a reservation
-- that is only partly released is split, exactly like the delivery consumption does. Returns what was freed.
create or replace function private.release_line_stock(
  p_order_item_id uuid,
  p_location_id uuid,
  p_qty int,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch record;
  v_res record;
  v_left int := p_qty;
  v_cut int;
  v_batch_left int;
  v_row_cut int;
begin
  perform set_config('app.inventory_posting', 'on', true);
  for v_batch in
    select r.batch_id, sum(r.quantity)::int as reserved
    from public.inventory_reservations r
    join public.product_batches pb on pb.id = r.batch_id
    where r.order_item_id = p_order_item_id and r.location_id = p_location_id
      and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'
    group by r.batch_id, pb.expiry_date, pb.manufactured_date
    order by pb.expiry_date desc, pb.manufactured_date desc, r.batch_id desc
  loop
    exit when v_left <= 0;
    v_cut := least(
      greatest(v_batch.reserved - private.bound_batch_qty(p_order_item_id, p_location_id, v_batch.batch_id), 0),
      v_left);
    continue when v_cut <= 0;

    v_batch_left := v_cut;
    for v_res in
      select r.* from public.inventory_reservations r
      where r.order_item_id = p_order_item_id and r.location_id = p_location_id and r.batch_id = v_batch.batch_id
        and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'
      order by r.id desc
      for update of r
    loop
      exit when v_batch_left <= 0;
      v_row_cut := least(v_res.quantity, v_batch_left);
      update public.inventory_balances set reserved_qty = reserved_qty - v_row_cut
      where location_id = v_res.location_id and product_id = v_res.product_id and batch_id = v_res.batch_id;
      if v_row_cut = v_res.quantity then
        update public.inventory_reservations
        set status = 'RELEASED', released_at = now(), release_reason = p_reason
        where id = v_res.id;
      else
        update public.inventory_reservations set quantity = quantity - v_row_cut where id = v_res.id;
        insert into public.inventory_reservations (
          order_id, order_item_id, location_id, product_id, batch_id, quantity, reservation_type,
          status, reserved_at, released_at, release_reason
        ) values (
          v_res.order_id, v_res.order_item_id, v_res.location_id, v_res.product_id, v_res.batch_id, v_row_cut,
          'PHYSICAL_ALLOCATION', 'RELEASED', v_res.reserved_at, now(), p_reason);
      end if;
      v_batch_left := v_batch_left - v_row_cut;
    end loop;

    update public.order_items set allocated_quantity = allocated_quantity - v_cut where id = p_order_item_id;
    v_left := v_left - v_cut;
  end loop;
  perform set_config('app.inventory_posting', 'off', true);
  return p_qty - v_left;
end;
$$;

-- ---------------------------------------------------------------------------
-- Binder (replaces the DEL-011 one): bind each batch by what is still FREE in it, not by queue position.
-- Same result as before whenever the reservation queue only ever shrank. It is also correct when stock was
-- reserved for another delivery AFTER a sibling already left the warehouse (a new, earlier-expiring batch
-- would otherwise shift the positional offset and double-book a batch already bound to goods in logistics).
-- Still bound once, at the first dispatch; still re-validated for sellability; contract unchanged.
-- ---------------------------------------------------------------------------
create or replace function private.bind_delivery_item_batches(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.deliveries;
  v_item record;
  v_batch record;
  v_remaining int;
  v_take int;
begin
  select * into v_delivery from public.deliveries where id = p_delivery_id;

  for v_item in select * from public.delivery_items where delivery_id = p_delivery_id order by order_item_id loop
    v_remaining := v_item.quantity;

    perform 1 from public.inventory_reservations r
    where r.order_item_id = v_item.order_item_id and r.location_id = v_delivery.source_location_id
      and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'
    order by r.id
    for update of r;

    for v_batch in
      select r.batch_id, sum(r.quantity)::int as reserved
      from public.inventory_reservations r
      join public.product_batches pb on pb.id = r.batch_id
      where r.order_item_id = v_item.order_item_id and r.location_id = v_delivery.source_location_id
        and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'
      group by r.batch_id, pb.expiry_date, pb.manufactured_date
      order by pb.expiry_date, pb.manufactured_date, r.batch_id
    loop
      exit when v_remaining <= 0;
      v_take := least(
        v_batch.reserved - private.bound_batch_qty(
          v_item.order_item_id, v_delivery.source_location_id, v_batch.batch_id, p_delivery_id),
        v_remaining);
      continue when v_take <= 0;

      perform private.assert_batch_sellable(v_batch.batch_id);

      perform set_config('app.inventory_posting', 'on', true);
      insert into public.delivery_item_batches (delivery_item_id, batch_id, quantity)
      values (v_item.id, v_batch.batch_id, v_take)
      on conflict (delivery_item_id, batch_id) do update
        set quantity = public.delivery_item_batches.quantity + excluded.quantity;
      perform set_config('app.inventory_posting', 'off', true);

      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      raise exception 'Chưa đủ hàng đã phân bổ tại kho xuất của đợt giao này (thiếu %). Hãy phân bổ hàng cho đơn tại đúng kho xuất.', v_remaining
        using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

revoke all on function private.reserved_physical_qty(uuid, uuid), private.delivery_open_qty(uuid, uuid),
  private.bound_batch_qty(uuid, uuid, uuid, uuid), private.delivery_stock_coverage(uuid, uuid),
  private.releasable_surplus_qty(uuid, uuid), private.stock_quota(uuid, uuid, boolean),
  private.reserve_line_stock(uuid, uuid, int, boolean), private.release_line_stock(uuid, uuid, int, text),
  private.bind_delivery_item_batches(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- allocate_delivery_stock: reserve exactly the gap of ONE delivery at ITS source (Admin or Warehouse).
-- All or nothing: with a shortage at the source nothing changes anywhere (the shortage and where to get
-- the stock are returned instead). Repeating the call is a no-op; two calls at once are serialised by the
-- delivery and order row locks, so the second finds nothing left to reserve.
-- ---------------------------------------------------------------------------
create or replace function public.allocate_delivery_stock(
  p_delivery_id uuid,
  p_allow_below_safety boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_delivery public.deliveries;
  v_order public.orders;
  v_loc public.locations;
  v_line record;
  v_oi public.order_items;
  v_x record;
  v_plan jsonb := '[]'::jsonb;
  v_out jsonb := '[]'::jsonb;
  v_gap int;
  v_quota int;
  v_short int := 0;
  v_over int;
  v_active int;
  v_released int;
  v_cut int;
  v_taken int;
  v_alloc_total int := 0;
  v_release_total int := 0;
  v_reason text;
  v_result jsonb;
begin
  if not private.has_role(array['ADMIN', 'WAREHOUSE']) then
    raise exception 'Chỉ Admin hoặc Kho được phân bổ hàng cho đợt giao.' using errcode = '42501';
  end if;
  if p_allow_below_safety and not private.is_admin() then
    raise exception 'Chỉ Admin được phép dùng tồn an toàn.' using errcode = '42501';
  end if;

  -- Same lock order as transition_delivery: delivery first, then its order.
  select * into v_delivery from public.deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'Không tìm thấy đợt giao.';
  end if;
  select * into v_order from public.orders where id = v_delivery.order_id for update;

  if v_delivery.status not in ('PREPARING', 'READY') then
    raise exception 'Chỉ phân bổ hàng cho đợt giao đang chuẩn bị hoặc sẵn sàng giao (hiện là %).', v_delivery.status
      using errcode = 'P0001';
  end if;
  if v_order.status not in ('CONFIRMED', 'RESERVED', 'PREPARING', 'WAITING_DELIVERY') then
    raise exception 'Đơn ở trạng thái % không thể phân bổ hàng cho đợt giao.', v_order.status using errcode = 'P0001';
  end if;
  perform private.assert_location_active(v_delivery.source_location_id);
  select * into v_loc from public.locations where id = v_delivery.source_location_id;

  -- 1. Plan and check (no writes): what does each line still need at the source, can the source cover it?
  for v_line in
    select di.order_item_id, di.product_id, di.quantity
    from public.delivery_items di where di.delivery_id = p_delivery_id
    order by di.product_id
  loop
    select c.gap into v_gap
    from private.delivery_stock_coverage(v_line.order_item_id, v_delivery.source_location_id) c
    where c.delivery_id = p_delivery_id;
    v_gap := coalesce(v_gap, v_line.quantity);

    v_quota := 0;
    if v_gap > 0 then
      v_quota := private.stock_quota(v_delivery.source_location_id, v_line.product_id, p_allow_below_safety);
      v_short := v_short + greatest(v_gap - v_quota, 0);
    end if;
    v_plan := v_plan || jsonb_build_object(
      'order_item_id', v_line.order_item_id, 'product_id', v_line.product_id, 'quantity', v_line.quantity,
      'requested', v_gap, 'covered_before', v_line.quantity - v_gap,
      'shortage', greatest(v_gap - v_quota, 0));
  end loop;

  if v_short > 0 then
    return jsonb_build_object(
      'delivery_id', v_delivery.id, 'delivery_code', v_delivery.delivery_code,
      'location_id', v_delivery.source_location_id, 'order_status', v_order.status,
      'fully_allocated', false, 'shortage_total', v_short, 'allocated_total', 0, 'released_total', 0,
      'lines', v_plan);
  end if;

  -- 2. Apply: take back what the order holds elsewhere beyond what it still has to deliver, then reserve.
  v_reason := 'Phân bổ hàng cho đợt giao ' || v_delivery.delivery_code || ' tại kho ' || v_loc.code;
  perform set_config('app.audit_reason', v_reason, true);

  for v_line in
    select (e ->> 'order_item_id')::uuid as order_item_id, (e ->> 'product_id')::uuid as product_id,
           (e ->> 'requested')::int as requested, e as plan
    from jsonb_array_elements(v_plan) e
  loop
    v_released := 0;
    v_taken := 0;
    if v_line.requested > 0 then
      select * into v_oi from public.order_items where id = v_line.order_item_id for update;

      select coalesce(sum(r.quantity), 0)::int into v_active
      from public.inventory_reservations r
      where r.order_item_id = v_line.order_item_id and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION';
      -- Never re-reserve what was already delivered: only quantity - delivered_quantity is still owed.
      v_over := v_active + v_line.requested - (v_oi.quantity - v_oi.delivered_quantity);

      if v_over > 0 then
        for v_x in
          select l.location_id, private.releasable_surplus_qty(v_line.order_item_id, l.location_id) as surplus
          from (
            select distinct r.location_id from public.inventory_reservations r
            where r.order_item_id = v_line.order_item_id and r.status = 'ACTIVE'
              and r.reservation_type = 'PHYSICAL_ALLOCATION' and r.location_id <> v_delivery.source_location_id
          ) l
          order by 2 desc, 1
        loop
          exit when v_over <= 0;
          v_cut := least(v_x.surplus, v_over);
          continue when v_cut <= 0;
          v_cut := private.release_line_stock(v_line.order_item_id, v_x.location_id, v_cut,
            'Chuyển phân bổ sang kho xuất ' || v_loc.code || ' cho đợt giao ' || v_delivery.delivery_code);
          v_over := v_over - v_cut;
          v_released := v_released + v_cut;
        end loop;
      end if;

      select * into v_oi from public.order_items where id = v_line.order_item_id;
      if v_oi.allocated_quantity + v_oi.delivered_quantity + v_line.requested > v_oi.quantity then
        raise exception 'Đơn đang giữ hàng ở kho khác không thể giải phóng để phân bổ thêm cho đợt giao này. Vui lòng liên hệ Admin.'
          using errcode = 'P0001';
      end if;

      v_taken := private.reserve_line_stock(
        v_line.order_item_id, v_delivery.source_location_id, v_line.requested, p_allow_below_safety);
      if v_taken <> v_line.requested then
        raise exception 'Kho xuất không còn đủ hàng để phân bổ (cần %, chỉ giữ được %).', v_line.requested, v_taken
          using errcode = 'P0001';
      end if;

      perform set_config('app.inventory_posting', 'on', true);
      insert into public.delivery_stock_allocations (delivery_id, order_item_id, location_id, quantity, allocated_by)
      values (p_delivery_id, v_line.order_item_id, v_delivery.source_location_id, v_taken, v_uid);
      perform set_config('app.inventory_posting', 'off', true);
    end if;

    v_alloc_total := v_alloc_total + v_taken;
    v_release_total := v_release_total + v_released;
    v_out := v_out || ((v_line.plan) || jsonb_build_object('allocated_now', v_taken, 'released_elsewhere', v_released, 'shortage', 0));
  end loop;

  -- 3. A CONFIRMED order whose every line is now covered (anywhere) becomes RESERVED, as allocate_order does.
  if v_order.status = 'CONFIRMED' and v_alloc_total > 0
     and not exists (
       select 1 from public.order_items i
       where i.order_id = v_order.id and i.allocated_quantity + i.delivered_quantity < i.quantity
     ) then
    perform set_config('app.audit_reason', 'Đã phân bổ đủ hàng theo từng đợt giao', true);
    update public.orders set status = 'RESERVED' where id = v_order.id;
    v_order.status := 'RESERVED';
  end if;
  perform set_config('app.audit_reason', '', true);

  v_result := jsonb_build_object(
    'delivery_id', v_delivery.id, 'delivery_code', v_delivery.delivery_code,
    'location_id', v_delivery.source_location_id, 'order_status', (select o.status from public.orders o where o.id = v_order.id),
    'fully_allocated', true, 'shortage_total', 0,
    'allocated_total', v_alloc_total, 'released_total', v_release_total, 'lines', v_out);

  if v_alloc_total > 0 or v_release_total > 0 then
    insert into public.audit_logs (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
    values (v_uid, 'deliveries', v_delivery.id, 'allocate_stock', null, v_result, v_reason);
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- delivery_allocation_status: what the screen needs before and after allocating (Admin or Warehouse).
-- ---------------------------------------------------------------------------
create or replace function public.delivery_allocation_status(p_delivery_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_delivery public.deliveries;
  v_order public.orders;
  v_loc public.locations;
  v_input jsonb;
  v_lines jsonb;
  v_gap_total int;
  v_open boolean;
begin
  if not private.has_role(array['ADMIN', 'WAREHOUSE']) then
    raise exception 'Chỉ Admin hoặc Kho được xem phân bổ hàng của đợt giao.' using errcode = '42501';
  end if;
  select * into v_delivery from public.deliveries where id = p_delivery_id;
  if not found then
    raise exception 'Không tìm thấy đợt giao.';
  end if;
  v_open := v_delivery.status not in ('DELIVERED', 'CANCELLED');
  select * into v_order from public.orders where id = v_delivery.order_id;
  select * into v_loc from public.locations where id = v_delivery.source_location_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'order_item_id', di.order_item_id, 'product_id', di.product_id, 'sku', p.sku, 'name', p.name,
      'delivery_quantity', di.quantity,
      'covered_for_delivery', di.quantity - (case when v_open then coalesce(c.gap, di.quantity) else 0 end),
      'quantity', case when v_open then coalesce(c.gap, di.quantity) else 0 end, 'covered', 0
    ) order by p.sku), '[]'::jsonb)
  into v_input
  from public.delivery_items di
  join public.products p on p.id = di.product_id
  left join lateral private.delivery_stock_coverage(di.order_item_id, v_delivery.source_location_id) c
    on c.delivery_id = di.delivery_id
  where di.delivery_id = p_delivery_id;

  select coalesce(jsonb_agg(
    l || jsonb_build_object('held_elsewhere', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'location_id', x.location_id, 'code', loc.code, 'name', loc.name, 'quantity', x.qty,
        'releasable', private.releasable_surplus_qty((l ->> 'order_item_id')::uuid, x.location_id)
      ) order by loc.code), '[]'::jsonb)
      from (
        select r.location_id, sum(r.quantity)::int as qty
        from public.inventory_reservations r
        where r.order_item_id = (l ->> 'order_item_id')::uuid and r.status = 'ACTIVE'
          and r.reservation_type = 'PHYSICAL_ALLOCATION' and r.location_id <> v_delivery.source_location_id
        group by r.location_id
      ) x join public.locations loc on loc.id = x.location_id
    ))
  ), '[]'::jsonb)
  into v_lines
  from jsonb_array_elements(private.stock_check_lines(v_delivery.source_location_id, v_input)) l;

  select coalesce(sum((l ->> 'quantity')::int), 0) into v_gap_total from jsonb_array_elements(v_input) l;

  return jsonb_build_object(
    'delivery_id', v_delivery.id, 'delivery_code', v_delivery.delivery_code,
    'delivery_status', v_delivery.status, 'order_id', v_order.id, 'order_status', v_order.status,
    'source_location', jsonb_build_object('id', v_loc.id, 'code', v_loc.code, 'name', v_loc.name),
    'can_allocate', v_delivery.status in ('PREPARING', 'READY')
      and v_order.status in ('CONFIRMED', 'RESERVED', 'PREPARING', 'WAITING_DELIVERY'),
    'fully_covered', v_gap_total = 0,
    'lines', v_lines);
end;
$$;

revoke all on function public.allocate_delivery_stock(uuid, boolean), public.delivery_allocation_status(uuid)
  from public, anon;
grant execute on function public.allocate_delivery_stock(uuid, boolean), public.delivery_allocation_status(uuid)
  to authenticated;
