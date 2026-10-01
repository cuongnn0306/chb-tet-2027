-- DEL-006, DEL-011, DEL-012, DEL-013, DEL-007..010, DEL-014, DEL-015: delivery workflow.
-- TECH_DESIGN §7; PRD §16, §17.
--
-- Rules:
--   * Physical allocation (E05) is the gate: a delivery can be prepared, dispatched and delivered only
--     for an order that is RESERVED / PREPARING / WAITING_DELIVERY.
--   * DELIVERED creates the SALE_OUT movements from the stock reserved for the order at the delivery's
--     source location (FEFO order of the reserved batches) and counts delivered_quantity.
--   * FAILED does not give stock back: the goods stay reserved until the warehouse takes them back
--     (TECH_DESIGN §7). A failed delivery can be rescheduled (FAILED -> READY).
--   * The order follows its deliveries: RESERVED -> PREPARING (a delivery exists) -> WAITING_DELIVERY
--     (a delivery is READY/OUT) -> COMPLETED (everything delivered AND paid in full).

-- ---------------------------------------------------------------------------
-- The posting function, extended: it can now consume reserved stock for a delivery and records the
-- delivery in the ledger. (Replaces the previous signature; callers with <= 7 arguments still work.)
-- ---------------------------------------------------------------------------
drop function if exists private.post_inventory_movement(text, uuid, uuid, uuid, uuid, int, text, uuid, uuid, uuid, uuid);

create or replace function private.post_inventory_movement(
  p_type text,
  p_product_id uuid,
  p_batch_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_quantity int,
  p_reason text default null,
  p_order_id uuid default null,
  p_transfer_id uuid default null,
  p_return_id uuid default null,
  p_production_run_id uuid default null,
  p_delivery_id uuid default null,
  -- true: the goods leave from stock that is already reserved for the order (a delivery, SALE_OUT only)
  p_consume_reservation boolean default false
)
returns public.inventory_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.product_batches;
  v_free int;
  v_have int;
  v_movement public.inventory_movements;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Số lượng phải lớn hơn 0.';
  end if;
  if p_consume_reservation and p_type <> 'SALE_OUT' then
    raise exception 'Chỉ xuất bán (SALE_OUT) mới được lấy từ hàng đã giữ cho đơn.';
  end if;

  select * into v_batch from public.product_batches where id = p_batch_id;
  if not found or v_batch.product_id <> p_product_id then
    raise exception 'Lô hàng không tồn tại hoặc không thuộc sản phẩm này.';
  end if;

  -- Open the guarded door for this transaction only.
  perform set_config('app.inventory_posting', 'on', true);

  -- Make sure the rows exist, then lock them in a fixed order (location id) to avoid deadlocks.
  if p_from_location_id is not null then
    insert into public.inventory_balances (location_id, product_id, batch_id)
    values (p_from_location_id, p_product_id, p_batch_id)
    on conflict (location_id, product_id, batch_id) do nothing;
  end if;
  if p_to_location_id is not null then
    insert into public.inventory_balances (location_id, product_id, batch_id)
    values (p_to_location_id, p_product_id, p_batch_id)
    on conflict (location_id, product_id, batch_id) do nothing;
  end if;
  perform 1
  from public.inventory_balances
  where product_id = p_product_id and batch_id = p_batch_id
    and location_id in (p_from_location_id, p_to_location_id)
  order by location_id
  for update;

  -- A delivery consumes stock that is already reserved for its order.
  if p_consume_reservation then
    select b.available_qty, b.reserved_qty into v_have, v_free
    from public.inventory_balances b
    where b.location_id = p_from_location_id and b.product_id = p_product_id and b.batch_id = p_batch_id;
    if v_have < p_quantity or v_free < p_quantity then
      raise exception 'Không đủ hàng đã giữ cho đơn tại kho xuất (lô %: đang giữ %, yêu cầu %).',
        v_batch.batch_code, v_free, p_quantity using errcode = 'P0001';
    end if;
  -- Outgoing from available stock: only what is free (not reserved) may leave.
  elsif p_type in ('SALE_OUT', 'DAMAGE_OUT', 'SAMPLE_OUT', 'GIFT_OUT', 'ADJUSTMENT_OUT', 'TRANSFER_OUT') then
    select b.available_qty - b.reserved_qty into v_free
    from public.inventory_balances b
    where b.location_id = p_from_location_id and b.product_id = p_product_id and b.batch_id = p_batch_id;
    if v_free < p_quantity then
      raise exception 'Không đủ hàng khả dụng tại kho này: lô % còn % có thể xuất, yêu cầu %.',
        v_batch.batch_code, v_free, p_quantity using errcode = 'P0001';
    end if;
  end if;

  case p_type
    when 'PRODUCTION_IN', 'ADJUSTMENT_IN' then
      update public.inventory_balances set available_qty = available_qty + p_quantity
      where location_id = p_to_location_id and product_id = p_product_id and batch_id = p_batch_id;

    when 'SALE_OUT', 'ADJUSTMENT_OUT' then
      update public.inventory_balances
      set available_qty = available_qty - p_quantity,
          reserved_qty = reserved_qty - case when p_consume_reservation then p_quantity else 0 end
      where location_id = p_from_location_id and product_id = p_product_id and batch_id = p_batch_id;

    when 'DAMAGE_OUT' then
      update public.inventory_balances
      set available_qty = available_qty - p_quantity, damaged_qty = damaged_qty + p_quantity
      where location_id = p_from_location_id and product_id = p_product_id and batch_id = p_batch_id;

    when 'SAMPLE_OUT' then
      update public.inventory_balances
      set available_qty = available_qty - p_quantity, sample_qty = sample_qty + p_quantity
      where location_id = p_from_location_id and product_id = p_product_id and batch_id = p_batch_id;

    when 'GIFT_OUT' then
      update public.inventory_balances
      set available_qty = available_qty - p_quantity, gift_qty = gift_qty + p_quantity
      where location_id = p_from_location_id and product_id = p_product_id and batch_id = p_batch_id;

    when 'TRANSFER_OUT' then
      -- Leaves the source now; shows as in transit at the destination until it is received.
      update public.inventory_balances set available_qty = available_qty - p_quantity
      where location_id = p_from_location_id and product_id = p_product_id and batch_id = p_batch_id;
      update public.inventory_balances set in_transfer_qty = in_transfer_qty + p_quantity
      where location_id = p_to_location_id and product_id = p_product_id and batch_id = p_batch_id;

    when 'TRANSFER_IN' then
      select in_transfer_qty into v_have from public.inventory_balances
      where location_id = p_to_location_id and product_id = p_product_id and batch_id = p_batch_id;
      if v_have < p_quantity then
        raise exception 'Số lượng nhận (%) lớn hơn số đang điều chuyển tới kho này (%).', p_quantity, v_have
          using errcode = 'P0001';
      end if;
      update public.inventory_balances
      set in_transfer_qty = in_transfer_qty - p_quantity, available_qty = available_qty + p_quantity
      where location_id = p_to_location_id and product_id = p_product_id and batch_id = p_batch_id;

    when 'RETURN_IN' then
      -- Returned stock is not sellable until inspected (PRD §20).
      update public.inventory_balances set pending_inspection_qty = pending_inspection_qty + p_quantity
      where location_id = p_to_location_id and product_id = p_product_id and batch_id = p_batch_id;

    when 'INSPECTION_TO_AVAILABLE', 'INSPECTION_TO_DAMAGED' then
      select pending_inspection_qty into v_have from public.inventory_balances
      where location_id = p_to_location_id and product_id = p_product_id and batch_id = p_batch_id;
      if v_have < p_quantity then
        raise exception 'Số lượng kiểm tra (%) lớn hơn số đang chờ kiểm tra (%).', p_quantity, v_have
          using errcode = 'P0001';
      end if;
      update public.inventory_balances
      set pending_inspection_qty = pending_inspection_qty - p_quantity,
          available_qty = available_qty + case when p_type = 'INSPECTION_TO_AVAILABLE' then p_quantity else 0 end,
          damaged_qty = damaged_qty + case when p_type = 'INSPECTION_TO_DAMAGED' then p_quantity else 0 end
      where location_id = p_to_location_id and product_id = p_product_id and batch_id = p_batch_id;

    else
      raise exception 'Loại movement không hợp lệ: %', p_type;
  end case;

  insert into public.inventory_movements (
    movement_type, product_id, batch_id, from_location_id, to_location_id, quantity,
    order_id, transfer_id, return_id, production_run_id, delivery_id, reason, created_by
  ) values (
    p_type, p_product_id, p_batch_id, p_from_location_id, p_to_location_id, p_quantity,
    p_order_id, p_transfer_id, p_return_id, p_production_run_id, p_delivery_id,
    nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid())
  ) returning * into v_movement;

  perform set_config('app.inventory_posting', 'off', true);
  return v_movement;
end;
$$;

revoke all on function private.post_inventory_movement(text, uuid, uuid, uuid, uuid, int, text, uuid, uuid, uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function private.post_inventory_movement(text, uuid, uuid, uuid, uuid, int, text, uuid, uuid, uuid, uuid, uuid, boolean)
  to service_role;


-- ---------------------------------------------------------------------------
-- Stock consumption when a delivery is DELIVERED (SALE_OUT, FEFO over the reserved batches)
-- ---------------------------------------------------------------------------
create or replace function private.consume_order_item_stock(
  p_order_item_id uuid,
  p_location_id uuid,
  p_qty int,
  p_delivery_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.order_items;
  v_res record;
  v_take int;
  v_remaining int := p_qty;
begin
  select * into v_item from public.order_items where id = p_order_item_id for update;

  for v_res in
    select r.*
    from public.inventory_reservations r
    join public.product_batches pb on pb.id = r.batch_id
    where r.order_item_id = p_order_item_id and r.location_id = p_location_id
      and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'
    order by pb.expiry_date, pb.manufactured_date, r.id
    for update of r
  loop
    exit when v_remaining <= 0;
    v_take := least(v_res.quantity, v_remaining);

    -- The movement lowers available AND reserved for this batch (the goods leave reserved stock).
    perform private.post_inventory_movement(
      'SALE_OUT', v_item.product_id, v_res.batch_id, p_location_id, null, v_take,
      'Giao hàng cho khách', v_item.order_id, null, null, null, p_delivery_id, true);

    -- Reservation bookkeeping (the posting function switched its guard flag off again).
    perform set_config('app.inventory_posting', 'on', true);
    if v_take = v_res.quantity then
      update public.inventory_reservations
      set status = 'CONSUMED', released_at = now(), release_reason = 'Đã giao hàng'
      where id = v_res.id;
    else
      update public.inventory_reservations set quantity = quantity - v_take where id = v_res.id;
      insert into public.inventory_reservations (
        order_id, order_item_id, location_id, product_id, batch_id, quantity, reservation_type,
        status, reserved_at, released_at, release_reason
      ) values (
        v_res.order_id, v_res.order_item_id, v_res.location_id, v_res.product_id, v_res.batch_id, v_take,
        'PHYSICAL_ALLOCATION', 'CONSUMED', v_res.reserved_at, now(), 'Đã giao hàng');
    end if;
    perform set_config('app.inventory_posting', 'off', true);

    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Chưa đủ hàng đã phân bổ tại kho xuất cho sản phẩm này (thiếu %). Hãy phân bổ hàng tại đúng kho xuất hoặc đổi kho xuất của đợt giao.', v_remaining
      using errcode = 'P0001';
  end if;

  update public.order_items
  set delivered_quantity = delivered_quantity + p_qty, allocated_quantity = allocated_quantity - p_qty
  where id = p_order_item_id;
end;
$$;

-- Before goods leave: is enough stock reserved at the source (net of other deliveries already out)?
create or replace function private.assert_delivery_stock(p_delivery_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_delivery public.deliveries;
  v_row record;
begin
  select * into v_delivery from public.deliveries where id = p_delivery_id;
  for v_row in
    select di.order_item_id, di.quantity,
           coalesce((select sum(r.quantity) from public.inventory_reservations r
                     where r.order_item_id = di.order_item_id and r.location_id = v_delivery.source_location_id
                       and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'), 0) as reserved,
           coalesce((select sum(di2.quantity) from public.delivery_items di2
                     join public.deliveries d2 on d2.id = di2.delivery_id
                     where di2.order_item_id = di.order_item_id and d2.id <> p_delivery_id
                       and d2.source_location_id = v_delivery.source_location_id
                       and d2.status = 'OUT_FOR_DELIVERY'), 0) as already_out
    from public.delivery_items di where di.delivery_id = p_delivery_id
  loop
    if v_row.reserved - v_row.already_out < v_row.quantity then
      raise exception 'Chưa đủ hàng đã phân bổ tại kho xuất của đợt giao này (đang giữ %, cần %). Hãy phân bổ hàng cho đơn tại đúng kho xuất.',
        v_row.reserved - v_row.already_out, v_row.quantity using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Order follows its deliveries
-- ---------------------------------------------------------------------------
create or replace function private.try_complete_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if found and v_order.status = 'WAITING_DELIVERY'
     and not exists (select 1 from public.order_items i where i.order_id = p_order_id and i.delivered_quantity < i.quantity)
     and v_order.remaining_amount = 0 then
    perform set_config('app.audit_reason', 'Đã giao đủ hàng và thanh toán đủ', true);
    update public.orders set status = 'COMPLETED', completed_at = now() where id = p_order_id;
    perform set_config('app.audit_reason', '', true);
  end if;
end;
$$;

create or replace function private.sync_order_fulfilment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return;
  end if;

  if v_order.status = 'RESERVED'
     and exists (select 1 from public.deliveries d where d.order_id = p_order_id and d.status <> 'CANCELLED') then
    perform set_config('app.audit_reason', 'Đã có đợt giao: kho chuẩn bị hàng', true);
    update public.orders set status = 'PREPARING' where id = p_order_id;
    perform set_config('app.audit_reason', '', true);
    v_order.status := 'PREPARING';
  end if;

  if v_order.status = 'PREPARING'
     and exists (select 1 from public.deliveries d where d.order_id = p_order_id and d.status in ('READY', 'OUT_FOR_DELIVERY')) then
    perform set_config('app.audit_reason', 'Có đợt giao đang chờ giao', true);
    update public.orders set status = 'WAITING_DELIVERY' where id = p_order_id;
    perform set_config('app.audit_reason', '', true);
  end if;

  perform private.try_complete_order(p_order_id);
end;
$$;

create or replace function private.deliveries_fulfilment_hook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_order_fulfilment(new.order_id);
  return null;
end;
$$;

create trigger deliveries_fulfilment_sync
  after insert or update of status on public.deliveries
  for each row execute function private.deliveries_fulfilment_hook();

-- An order that becomes RESERVED while deliveries already exist moves on to PREPARING.
create or replace function private.orders_fulfilment_hook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'RESERVED' and old.status is distinct from 'RESERVED' then
    perform private.sync_order_fulfilment(new.id);
  end if;
  return null;
end;
$$;

create trigger orders_zz_fulfilment_sync
  after update of status on public.orders
  for each row execute function private.orders_fulfilment_hook();

-- Money can complete an order that was already fully delivered.
create or replace function private.payments_deposit_hook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'CONFIRMED' then
    perform private.apply_deposit_rule(new.order_id);
    perform private.try_complete_order(new.order_id);
  end if;
  return null;
end;
$$;

revoke all on function private.consume_order_item_stock(uuid, uuid, int, uuid), private.assert_delivery_stock(uuid),
  private.try_complete_order(uuid), private.sync_order_fulfilment(uuid), private.deliveries_fulfilment_hook(),
  private.orders_fulfilment_hook(), private.payments_deposit_hook() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- DEL-004/005: plan a delivery (create, or fully replace one that is still PREPARING)
-- ---------------------------------------------------------------------------
create or replace function public.save_delivery(
  p_delivery_id uuid,
  p_order_id uuid,
  p_scheduled_date date,
  p_items jsonb,
  p_scheduled_time time default null,
  p_recipient_name text default null,
  p_recipient_phone text default null,
  p_delivery_address text default null,
  p_source_location_id uuid default null,
  p_delivery_method text default 'CHB_DELIVERY',
  p_shipping_fee bigint default 0,
  p_shipping_fee_payer text default 'CUSTOMER',
  p_notes text default null
)
returns public.deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_order public.orders;
  v_customer public.customers;
  v_existing public.deliveries;
  v_delivery public.deliveries;
  v_source uuid;
  v_name text;
  v_phone text;
  v_address text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found
     or not (private.is_admin() or (private.can_create_orders() and (v_order.owner_user_id = v_uid or v_order.created_by = v_uid))) then
    raise exception 'Không tìm thấy đơn hàng hoặc bạn không có quyền lập lịch giao cho đơn này.' using errcode = '42501';
  end if;
  if v_order.status in ('COMPLETED', 'CANCELLED', 'VOIDED', 'RETURNED', 'EXCHANGED') then
    raise exception 'Đơn ở trạng thái % không thể lập thêm đợt giao.', v_order.status;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Đợt giao cần có ít nhất một sản phẩm.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e -> 'order_item_id') <> 'string' or jsonb_typeof(e -> 'quantity') <> 'number'
       or (e ->> 'quantity') !~ '^[1-9][0-9]{0,8}$'
  ) then
    raise exception 'Mỗi dòng giao cần có dòng sản phẩm của đơn và số lượng là số nguyên dương.';
  end if;

  select * into v_customer from public.customers where id = v_order.customer_id;
  v_name := coalesce(nullif(btrim(coalesce(p_recipient_name, '')), ''),
    case when v_customer.customer_type = 'COMPANY' then coalesce(v_customer.contact_name, v_customer.company_name) else v_customer.name end);
  v_phone := coalesce(nullif(btrim(coalesce(p_recipient_phone, '')), ''), v_customer.phone);
  v_address := coalesce(nullif(btrim(coalesce(p_delivery_address, '')), ''),
    case when v_customer.customer_type = 'COMPANY' then v_customer.company_address else v_customer.address end);
  v_source := coalesce(p_source_location_id, v_order.creation_location_id);
  perform private.assert_location_active(v_source);

  if p_delivery_id is null then
    if p_scheduled_date is null or p_scheduled_date < private.business_today() then
      raise exception 'Ngày giao phải từ hôm nay trở đi.';
    end if;
    insert into public.deliveries (
      delivery_code, order_id, scheduled_date, scheduled_time, recipient_name, recipient_phone, delivery_address,
      source_location_id, delivery_method, shipping_fee, shipping_fee_payer, notes, created_by
    ) values (
      '', p_order_id, p_scheduled_date, p_scheduled_time, coalesce(v_name, ''), coalesce(v_phone, ''), v_address,
      v_source, p_delivery_method, coalesce(p_shipping_fee, 0), p_shipping_fee_payer,
      nullif(btrim(coalesce(p_notes, '')), ''), v_uid
    ) returning * into v_delivery;
  else
    select * into v_existing from public.deliveries where id = p_delivery_id and order_id = p_order_id for update;
    if not found then
      raise exception 'Không tìm thấy đợt giao.';
    end if;
    if v_existing.status <> 'PREPARING' then
      raise exception 'Chỉ sửa được đợt giao đang chuẩn bị. Với đợt đã sẵn sàng hãy đổi lịch, hoặc hủy rồi tạo lại.';
    end if;
    update public.deliveries set
      scheduled_date = p_scheduled_date, scheduled_time = p_scheduled_time,
      recipient_name = coalesce(v_name, ''), recipient_phone = coalesce(v_phone, ''), delivery_address = v_address,
      source_location_id = v_source, delivery_method = p_delivery_method,
      shipping_fee = coalesce(p_shipping_fee, 0), shipping_fee_payer = p_shipping_fee_payer,
      notes = nullif(btrim(coalesce(p_notes, '')), '')
    where id = p_delivery_id returning * into v_delivery;
    delete from public.delivery_items where delivery_id = p_delivery_id;
  end if;

  insert into public.delivery_items (delivery_id, order_item_id, product_id, quantity)
  select v_delivery.id, oi.id, oi.product_id, t.qty
  from (
    select (e ->> 'order_item_id')::uuid as oid, sum((e ->> 'quantity')::int) as qty
    from jsonb_array_elements(p_items) e group by 1
  ) t
  join public.order_items oi on oi.id = t.oid and oi.order_id = p_order_id;

  if (select count(*) from public.delivery_items where delivery_id = v_delivery.id)
     <> (select count(distinct (e ->> 'order_item_id')) from jsonb_array_elements(p_items) e) then
    raise exception 'Có dòng sản phẩm không thuộc đơn hàng này.';
  end if;
  return v_delivery;
end;
$$;

-- ---------------------------------------------------------------------------
-- DEL-006/011/012: ready, dispatch, deliver, fail, cancel
-- ---------------------------------------------------------------------------
create or replace function public.transition_delivery(
  p_delivery_id uuid,
  p_action text,
  p_reason text default null
)
returns public.deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_delivery public.deliveries;
  v_order public.orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_item record;
begin
  select * into v_delivery from public.deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'Không tìm thấy đợt giao.';
  end if;
  select * into v_order from public.orders where id = v_delivery.order_id for update;

  if p_action = 'cancel' then
    if not (private.is_admin() or (private.can_create_orders() and (v_order.owner_user_id = v_uid or v_order.created_by = v_uid))) then
      raise exception 'Bạn không có quyền hủy đợt giao này.' using errcode = '42501';
    end if;
    if v_reason is null then
      raise exception 'Vui lòng nhập lý do hủy đợt giao.';
    end if;
    if v_delivery.status not in ('PREPARING', 'READY') then
      raise exception 'Đợt giao đã xuất kho hoặc đã đóng, không thể hủy.';
    end if;
    update public.deliveries set status = 'CANCELLED', cancelled_reason = v_reason where id = p_delivery_id
    returning * into v_delivery;
    return v_delivery;
  end if;

  if not private.has_role(array['ADMIN', 'WAREHOUSE']) then
    raise exception 'Chỉ Admin hoặc Kho được cập nhật trạng thái giao hàng.' using errcode = '42501';
  end if;
  if v_order.status not in ('RESERVED', 'PREPARING', 'WAITING_DELIVERY') then
    raise exception 'Đơn chưa được phân bổ hàng (đang ở trạng thái %). Hãy phân bổ hàng cho đơn trước khi chuẩn bị hoặc giao.', v_order.status
      using errcode = 'P0001';
  end if;

  if p_action = 'ready' then
    if v_delivery.status <> 'PREPARING' then
      raise exception 'Chỉ đợt giao đang chuẩn bị mới chuyển sang sẵn sàng.';
    end if;
    update public.deliveries set status = 'READY' where id = p_delivery_id returning * into v_delivery;

  elsif p_action = 'dispatch' then
    if v_delivery.status <> 'READY' then
      raise exception 'Chỉ đợt giao đã sẵn sàng mới xuất đi giao.';
    end if;
    perform private.assert_delivery_stock(p_delivery_id);
    update public.deliveries set status = 'OUT_FOR_DELIVERY' where id = p_delivery_id returning * into v_delivery;

  elsif p_action = 'deliver' then
    if v_delivery.status <> 'OUT_FOR_DELIVERY' then
      raise exception 'Chỉ đợt giao đang đi giao mới xác nhận đã giao.';
    end if;
    for v_item in select * from public.delivery_items where delivery_id = p_delivery_id order by order_item_id loop
      perform private.consume_order_item_stock(v_item.order_item_id, v_delivery.source_location_id, v_item.quantity, p_delivery_id);
    end loop;
    update public.deliveries set status = 'DELIVERED', delivered_at = now() where id = p_delivery_id returning * into v_delivery;

  elsif p_action = 'fail' then
    if v_delivery.status <> 'OUT_FOR_DELIVERY' then
      raise exception 'Chỉ đợt giao đang đi giao mới ghi nhận giao thất bại.';
    end if;
    if v_reason is null then
      raise exception 'Vui lòng nhập lý do giao thất bại.';
    end if;
    update public.deliveries set status = 'FAILED', failed_reason = v_reason where id = p_delivery_id returning * into v_delivery;

  else
    raise exception 'Thao tác không hợp lệ: %', p_action;
  end if;
  return v_delivery;
end;
$$;

-- DEL-013: reschedule a failed delivery (FAILED -> READY)
create or replace function public.reschedule_delivery(
  p_delivery_id uuid,
  p_scheduled_date date,
  p_scheduled_time time default null,
  p_reason text default null
)
returns public.deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.deliveries;
begin
  if not private.has_role(array['ADMIN', 'WAREHOUSE']) then
    raise exception 'Chỉ Admin hoặc Kho được đổi lịch giao.' using errcode = '42501';
  end if;
  if p_scheduled_date is null or p_scheduled_date < private.business_today() then
    raise exception 'Ngày giao mới phải từ hôm nay trở đi.';
  end if;
  select * into v_delivery from public.deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'Không tìm thấy đợt giao.';
  end if;

  if v_delivery.status = 'FAILED' then
    update public.deliveries
    set status = 'READY', scheduled_date = p_scheduled_date, scheduled_time = p_scheduled_time,
        notes = concat_ws(E'\n', notes, 'Đổi lịch sau khi giao thất bại: ' || coalesce(nullif(btrim(coalesce(p_reason, '')), ''), v_delivery.failed_reason))
    where id = p_delivery_id returning * into v_delivery;
  elsif v_delivery.status in ('PREPARING', 'READY') then
    update public.deliveries set scheduled_date = p_scheduled_date, scheduled_time = p_scheduled_time
    where id = p_delivery_id returning * into v_delivery;
  else
    raise exception 'Đợt giao ở trạng thái % không đổi lịch được.', v_delivery.status;
  end if;
  return v_delivery;
end;
$$;

-- ---------------------------------------------------------------------------
-- DEL-007..010: the delivery board (today / tomorrow / next 7 days / calendar)
-- Admin and Warehouse see everything; sales roles see the deliveries of their own orders.
-- ---------------------------------------------------------------------------
create or replace function public.delivery_schedule(
  p_from date,
  p_to date,
  p_statuses text[] default null
)
returns table (
  delivery_id uuid,
  delivery_code text,
  order_id uuid,
  order_code text,
  order_status text,
  scheduled_date date,
  scheduled_time time,
  status text,
  recipient_name text,
  recipient_phone text,
  delivery_address text,
  delivery_method text,
  source_location_id uuid,
  source_location_code text,
  owner_name text,
  customer_name text,
  lines jsonb,
  total_quantity bigint,
  remaining_amount bigint,
  shipping_fee bigint,
  shipping_fee_payer text,
  stock_risk boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_all boolean := private.has_role(array['ADMIN', 'WAREHOUSE']);
begin
  if not (v_all or private.can_create_orders()) then
    raise exception 'Bạn không có quyền xem lịch giao hàng.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Khoảng ngày không hợp lệ.';
  end if;

  return query
  select
    d.id, d.delivery_code, o.id, o.order_code, o.status,
    d.scheduled_date, d.scheduled_time, d.status,
    d.recipient_name, d.recipient_phone, d.delivery_address, d.delivery_method,
    d.source_location_id, l.code, pr.full_name,
    case when c.customer_type = 'COMPANY' then c.company_name else c.name end,
    (select jsonb_agg(jsonb_build_object('sku', p.sku, 'name', p.name, 'quantity', di.quantity) order by p.sku)
       from public.delivery_items di join public.products p on p.id = di.product_id where di.delivery_id = d.id),
    (select coalesce(sum(di.quantity), 0) from public.delivery_items di where di.delivery_id = d.id)::bigint,
    o.remaining_amount,
    d.shipping_fee, d.shipping_fee_payer,
    -- risk: goods of an open delivery are not yet reserved at the source location
    (d.status in ('PREPARING', 'READY') and exists (
      select 1 from public.delivery_items di
      where di.delivery_id = d.id
        and coalesce((select sum(r.quantity) from public.inventory_reservations r
                      where r.order_item_id = di.order_item_id and r.location_id = d.source_location_id
                        and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'), 0) < di.quantity
    ))
  from public.deliveries d
  join public.orders o on o.id = d.order_id
  join public.locations l on l.id = d.source_location_id
  join public.profiles pr on pr.id = o.owner_user_id
  join public.customers c on c.id = o.customer_id
  where d.scheduled_date between p_from and p_to
    and (p_statuses is null or d.status = any (p_statuses))
    and (v_all or o.owner_user_id = v_uid or o.created_by = v_uid)
  order by d.scheduled_date, d.scheduled_time nulls last, d.delivery_code;
end;
$$;

-- DEL-014/015: everything needed to print the delivery note and the warehouse issue note
create or replace function public.delivery_detail(p_delivery_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_delivery public.deliveries;
  v_order public.orders;
begin
  select * into v_delivery from public.deliveries where id = p_delivery_id;
  if not found then
    raise exception 'Không tìm thấy đợt giao.';
  end if;
  select * into v_order from public.orders where id = v_delivery.order_id;
  if not (private.has_role(array['ADMIN', 'WAREHOUSE'])
          or (private.can_create_orders() and (v_order.owner_user_id = v_uid or v_order.created_by = v_uid))) then
    raise exception 'Bạn không có quyền xem đợt giao này.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'delivery', to_jsonb(v_delivery),
    'order', jsonb_build_object(
      'id', v_order.id, 'order_code', v_order.order_code, 'status', v_order.status,
      'net_amount', v_order.net_amount, 'paid_amount', v_order.paid_amount, 'remaining_amount', v_order.remaining_amount,
      'notes', v_order.notes, 'requires_invoice', v_order.requires_invoice,
      'owner_name', (select full_name from public.profiles where id = v_order.owner_user_id)),
    'source_location', (select jsonb_build_object('code', l.code, 'name', l.name, 'address', l.address)
                        from public.locations l where l.id = v_delivery.source_location_id),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'order_item_id', di.order_item_id, 'sku', p.sku, 'name', p.name, 'quantity', di.quantity,
        -- pick list: the first `quantity` units of the reserved batches at the source in FEFO order
        -- (the same order the stock is consumed in), so a multi-delivery order is not over-picked
        'pick', (select coalesce(jsonb_agg(jsonb_build_object(
                    'batch_code', x.batch_code, 'expiry_date', x.expiry_date, 'quantity', x.take)
                  order by x.expiry_date, x.manufactured_date, x.reservation_id), '[]'::jsonb)
                 from (
                   -- this delivery's units are the slice [offset, offset + quantity) of the FEFO line-up,
                   -- after the units of earlier deliveries of the same line that are still open
                   select pb.batch_code, pb.expiry_date, pb.manufactured_date, r.id as reservation_id,
                          greatest(
                            least(sum(r.quantity) over w, v_offset.qty + di.quantity)
                              - greatest(sum(r.quantity) over w - r.quantity, v_offset.qty),
                            0) as take
                   from public.inventory_reservations r join public.product_batches pb on pb.id = r.batch_id
                   cross join lateral (
                     select coalesce(sum(di2.quantity), 0)::int as qty
                     from public.delivery_items di2 join public.deliveries d2 on d2.id = di2.delivery_id
                     where di2.order_item_id = di.order_item_id and d2.id <> p_delivery_id
                       and d2.source_location_id = v_delivery.source_location_id
                       and d2.status in ('PREPARING', 'READY', 'OUT_FOR_DELIVERY')
                       and d2.created_at < v_delivery.created_at
                   ) v_offset
                   where r.order_item_id = di.order_item_id and r.location_id = v_delivery.source_location_id
                     and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'
                   window w as (order by pb.expiry_date, pb.manufactured_date, r.id)
                 ) x
                 where x.take > 0)
      ) order by p.sku), '[]'::jsonb)
      from public.delivery_items di join public.products p on p.id = di.product_id where di.delivery_id = p_delivery_id
    )
  );
end;
$$;

revoke all on function public.save_delivery(uuid, uuid, date, jsonb, time, text, text, text, uuid, text, bigint, text, text),
  public.transition_delivery(uuid, text, text), public.reschedule_delivery(uuid, date, time, text),
  public.delivery_schedule(date, date, text[]), public.delivery_detail(uuid) from public, anon;
grant execute on function public.save_delivery(uuid, uuid, date, jsonb, time, text, text, text, uuid, text, bigint, text, text),
  public.transition_delivery(uuid, text, text), public.reschedule_delivery(uuid, date, time, text),
  public.delivery_schedule(date, date, text[]), public.delivery_detail(uuid) to authenticated;
