-- DEL-012 (review RV-03): goods of a FAILED delivery stay in logistics.
--
-- TECH_DESIGN §7: "FAILED -> không tự trả tồn; hàng vẫn theo trạng thái logistics cho tới khi kho nhận lại".
-- Until now only OUT_FOR_DELIVERY deliveries were deducted from the stock reserved at the source, so a
-- FAILED delivery (and a FAILED one rescheduled back to READY) made its goods look available again and
-- another delivery from the same source could take the same units (order 10, X: 5 / Y: 5, A from X
-- failed, B from X dispatched).
--
-- Model: a delivery has "left the warehouse" from its first dispatch (dispatched_at) until it is
-- DELIVERED (the ledger then books SALE_OUT and consumes the reservation, once). In between, its units
-- are the delivery's footprint and are deducted from the reserved quantity available to every other
-- delivery of the same order line at the same source. Nothing is released implicitly: a status or schedule
-- change never frees goods, and the existing PHYSICAL_ALLOCATION reservation stays the single hold.
--
-- Returning goods to the warehouse ("kho nhận lại") is NOT specified anywhere (no state, no movement,
-- no role), so this migration adds no way to do it. Until it is specified, such a delivery can only end
-- by being delivered. A delivery whose goods left the warehouse therefore cannot be cancelled.

alter table public.deliveries add column dispatched_at timestamptz;

-- Rows that existed before this column: everything that already left the warehouse at least once.
update public.deliveries
set dispatched_at = coalesce(delivered_at, updated_at)
where dispatched_at is null
  and (status in ('OUT_FOR_DELIVERY', 'FAILED', 'DELIVERED') or failed_reason is not null);

alter table public.deliveries
  add constraint deliveries_dispatched_when_out
  check (status not in ('OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED') or dispatched_at is not null);

-- Guard: dispatched_at is written only by the first dispatch and never changes; goods that left the
-- warehouse cannot be cancelled.
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
    new.dispatched_at := null;
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

  -- The moment the goods left the warehouse: written by the first dispatch only, then immutable.
  if old.dispatched_at is not null then
    if new.dispatched_at is distinct from old.dispatched_at then
      raise exception 'Không được sửa thời điểm hàng rời kho của đợt giao.';
    end if;
  elsif new.status = 'OUT_FOR_DELIVERY' and old.status = 'READY' then
    new.dispatched_at := now();
  elsif new.dispatched_at is not null then
    raise exception 'Thời điểm hàng rời kho chỉ được ghi khi xuất kho đi giao.';
  end if;

  if new.status = 'CANCELLED' and new.dispatched_at is not null then
    raise exception 'Hàng của đợt giao này đã rời kho (đang ở logistics, chưa được kho nhận lại): không thể hủy đợt giao.';
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

  -- The source cannot move once goods have left it: the footprint is tied to that location.
  if old.dispatched_at is not null and new.source_location_id is distinct from old.source_location_id then
    raise exception 'Hàng của đợt giao đã rời kho xuất, không được đổi kho xuất.';
  end if;
  return new;
end;
$$;

-- Units of an order line that other deliveries from the same source have taken out of the warehouse and
-- that have not been delivered (so still reserved at the source but physically in logistics).
create or replace function private.delivery_logistics_qty(
  p_order_item_id uuid,
  p_location_id uuid,
  p_exclude_delivery uuid default null
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(di.quantity), 0)::int
  from public.delivery_items di
  join public.deliveries d on d.id = di.delivery_id
  where di.order_item_id = p_order_item_id
    and d.source_location_id = p_location_id
    and d.dispatched_at is not null
    and d.status not in ('DELIVERED', 'CANCELLED')
    and d.id is distinct from p_exclude_delivery
$$;

-- Before goods leave: is enough stock reserved at the source, net of every other delivery whose goods are
-- already in logistics (OUT_FOR_DELIVERY, FAILED, or FAILED and rescheduled)?
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
  v_free int;
begin
  select * into v_delivery from public.deliveries where id = p_delivery_id;
  for v_row in
    select di.order_item_id, di.quantity,
           coalesce((select sum(r.quantity) from public.inventory_reservations r
                     where r.order_item_id = di.order_item_id and r.location_id = v_delivery.source_location_id
                       and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'), 0)::int as reserved,
           private.delivery_logistics_qty(di.order_item_id, v_delivery.source_location_id, p_delivery_id) as in_logistics
    from public.delivery_items di where di.delivery_id = p_delivery_id
  loop
    v_free := v_row.reserved - v_row.in_logistics;
    if v_free < v_row.quantity then
      if v_row.in_logistics > 0 then
        raise exception 'Chưa đủ hàng tại kho xuất: % sản phẩm của đơn này đang ở logistics (đợt giao khác đang đi giao hoặc giao thất bại, kho chưa nhận lại), kho chỉ còn % có thể xuất, cần %.',
          v_row.in_logistics, greatest(v_free, 0), v_row.quantity using errcode = 'P0001';
      end if;
      raise exception 'Chưa đủ hàng đã phân bổ tại kho xuất của đợt giao này (đang giữ %, cần %). Hãy phân bổ hàng cho đơn tại đúng kho xuất.',
        v_free, v_row.quantity using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

revoke all on function private.delivery_logistics_qty(uuid, uuid, uuid) from public, anon, authenticated;

-- transition_delivery: unchanged except that cancelling goods which already left the warehouse is refused
-- with a clear message (the guard trigger refuses it too).
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
  -- Locking the order serialises every dispatch/deliver of the same order, so two deliveries cannot
  -- both claim the same reserved units.
  select * into v_order from public.orders where id = v_delivery.order_id for update;

  if p_action = 'cancel' then
    if not (private.is_admin() or (private.can_create_orders() and (v_order.owner_user_id = v_uid or v_order.created_by = v_uid))) then
      raise exception 'Bạn không có quyền hủy đợt giao này.' using errcode = '42501';
    end if;
    if v_reason is null then
      raise exception 'Vui lòng nhập lý do hủy đợt giao.';
    end if;
    if v_delivery.dispatched_at is not null and v_delivery.status <> 'DELIVERED' then
      raise exception 'Hàng của đợt giao này đã rời kho (đang ở logistics, kho chưa nhận lại): không thể hủy. Hãy đổi lịch và giao lại.'
        using errcode = 'P0001';
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
    -- The goods stay in logistics: no reservation or balance is touched (TECH_DESIGN §7).
    update public.deliveries set status = 'FAILED', failed_reason = v_reason where id = p_delivery_id returning * into v_delivery;

  else
    raise exception 'Thao tác không hợp lệ: %', p_action;
  end if;
  return v_delivery;
end;
$$;

-- The board: adds goods_in_logistics and computes stock_risk net of the goods other deliveries hold in logistics.
drop function public.delivery_schedule(date, date, text[]);

create function public.delivery_schedule(
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
  stock_risk boolean,
  goods_in_logistics boolean
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
    -- risk: an open delivery whose goods are not (any more) available at the source location, i.e. not
    -- reserved there, or held in logistics by another delivery
    (d.status in ('PREPARING', 'READY') and exists (
      select 1 from public.delivery_items di
      where di.delivery_id = d.id
        and coalesce((select sum(r.quantity) from public.inventory_reservations r
                      where r.order_item_id = di.order_item_id and r.location_id = d.source_location_id
                        and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'), 0)
            - private.delivery_logistics_qty(di.order_item_id, d.source_location_id, d.id) < di.quantity
    )),
    (d.dispatched_at is not null and d.status not in ('DELIVERED', 'CANCELLED'))
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

revoke all on function public.delivery_schedule(date, date, text[]) from public, anon;
grant execute on function public.delivery_schedule(date, date, text[]) to authenticated;
-- transition_delivery keeps its grants (create or replace preserves them).
