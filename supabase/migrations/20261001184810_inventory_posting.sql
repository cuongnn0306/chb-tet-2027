-- INV-004..011: the posting engine, no-negative-stock transactions, stock entry, adjustment,
-- sample/gift/damage exits, summary and ledger reconciliation.
--
-- private.post_inventory_movement() is the ONLY code that changes inventory_balances. It
--   1. validates the movement,
--   2. locks the affected balance rows (deterministic order, so transfers cannot deadlock),
--   3. refuses to take more than is free (available - reserved),
--   4. writes the immutable movement and updates the cache in the same transaction.
-- Two people taking the last unit at once: the second waits for the lock, then fails cleanly.

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
  p_production_run_id uuid default null
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

  -- Outgoing from available stock: only what is free (not reserved) may leave.
  if p_type in ('SALE_OUT', 'DAMAGE_OUT', 'SAMPLE_OUT', 'GIFT_OUT', 'ADJUSTMENT_OUT', 'TRANSFER_OUT') then
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
      update public.inventory_balances set available_qty = available_qty - p_quantity
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
    order_id, transfer_id, return_id, production_run_id, reason, created_by
  ) values (
    p_type, p_product_id, p_batch_id, p_from_location_id, p_to_location_id, p_quantity,
    p_order_id, p_transfer_id, p_return_id, p_production_run_id,
    nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid())
  ) returning * into v_movement;

  perform set_config('app.inventory_posting', 'off', true);
  return v_movement;
end;
$$;

revoke all on function private.post_inventory_movement(text, uuid, uuid, uuid, uuid, int, text, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.post_inventory_movement(text, uuid, uuid, uuid, uuid, int, text, uuid, uuid, uuid, uuid)
  to service_role;

-- Shared checks for the user-facing RPCs below.
create or replace function private.assert_location_active(p_location_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (select 1 from public.locations where id = p_location_id and is_active) then
    raise exception 'Địa điểm không tồn tại hoặc đã ngừng sử dụng.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- INV-005: opening stock (Admin). Recorded as ADJUSTMENT_IN with a fixed "Tồn đầu kỳ" reason.
-- ---------------------------------------------------------------------------
create or replace function public.record_opening_stock(
  p_location_id uuid,
  p_product_id uuid,
  p_batch_id uuid,
  p_quantity int,
  p_note text default null
)
returns public.inventory_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Chỉ Admin được nhập tồn đầu kỳ.' using errcode = '42501';
  end if;
  perform private.assert_location_active(p_location_id);
  return private.post_inventory_movement(
    'ADJUSTMENT_IN', p_product_id, p_batch_id, null, p_location_id, p_quantity,
    'Tồn đầu kỳ' || case when nullif(btrim(coalesce(p_note, '')), '') is not null then ': ' || btrim(p_note) else '' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- INV-010: manual adjustment (Admin + mandatory reason, audited through the ledger).
-- ---------------------------------------------------------------------------
create or replace function public.adjust_inventory(
  p_direction text,
  p_location_id uuid,
  p_product_id uuid,
  p_batch_id uuid,
  p_quantity int,
  p_reason text
)
returns public.inventory_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Chỉ Admin được điều chỉnh tồn kho.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Vui lòng nhập lý do điều chỉnh tồn kho.';
  end if;
  if p_direction not in ('IN', 'OUT') then
    raise exception 'Hướng điều chỉnh không hợp lệ (IN hoặc OUT).';
  end if;
  perform private.assert_location_active(p_location_id);
  return case p_direction
    when 'IN' then private.post_inventory_movement('ADJUSTMENT_IN', p_product_id, p_batch_id, null, p_location_id, p_quantity, p_reason)
    else private.post_inventory_movement('ADJUSTMENT_OUT', p_product_id, p_batch_id, p_location_id, null, p_quantity, p_reason)
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- INV-011: sample / gift / damage exits (Admin or Warehouse, reason required).
-- ---------------------------------------------------------------------------
create or replace function public.record_stock_exit(
  p_type text,
  p_location_id uuid,
  p_product_id uuid,
  p_batch_id uuid,
  p_quantity int,
  p_reason text
)
returns public.inventory_movements
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['ADMIN', 'WAREHOUSE']) then
    raise exception 'Chỉ Admin hoặc Kho được ghi nhận xuất hàng mẫu, biếu hoặc hỏng.' using errcode = '42501';
  end if;
  if p_type not in ('SAMPLE_OUT', 'GIFT_OUT', 'DAMAGE_OUT') then
    raise exception 'Loại xuất kho không hợp lệ.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Vui lòng nhập lý do xuất kho.';
  end if;
  perform private.assert_location_active(p_location_id);
  return private.post_inventory_movement(p_type, p_product_id, p_batch_id, p_location_id, null, p_quantity, p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- INV-007: summary per Location x SKU for every active role (no batch detail).
--   sellable = usable (available - reserved, only ACTIVE and not expired batches) - safety stock, floor 0
-- ---------------------------------------------------------------------------
create or replace function public.inventory_summary(p_location_id uuid default null)
returns table (
  location_id uuid,
  product_id uuid,
  available_qty int,
  reserved_qty int,
  expired_qty int,
  safety_stock_qty int,
  sellable_qty int,
  in_transfer_qty int,
  pending_inspection_qty int,
  damaged_qty int,
  sample_qty int,
  gift_qty int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := private.business_today();
begin
  if not private.is_active_user() then
    raise exception 'Bạn không có quyền xem tồn kho.' using errcode = '42501';
  end if;

  return query
  with stock as (
    select
      b.location_id,
      b.product_id,
      sum(b.available_qty)::int as available_qty,
      sum(b.reserved_qty)::int as reserved_qty,
      coalesce(sum(b.available_qty) filter (where pb.expiry_date < v_today), 0)::int as expired_qty,
      coalesce(sum(b.available_qty - b.reserved_qty)
        filter (where pb.status = 'ACTIVE' and pb.expiry_date >= v_today), 0)::int as usable_qty,
      sum(b.in_transfer_qty)::int as in_transfer_qty,
      sum(b.pending_inspection_qty)::int as pending_inspection_qty,
      sum(b.damaged_qty)::int as damaged_qty,
      sum(b.sample_qty)::int as sample_qty,
      sum(b.gift_qty)::int as gift_qty
    from public.inventory_balances b
    join public.product_batches pb on pb.id = b.batch_id
    group by b.location_id, b.product_id
  ),
  keys as (
    select s.location_id, s.product_id from stock s
    union
    select r.location_id, r.product_id from public.safety_stock_rules r
  )
  select
    k.location_id,
    k.product_id,
    coalesce(s.available_qty, 0),
    coalesce(s.reserved_qty, 0),
    coalesce(s.expired_qty, 0),
    coalesce(r.minimum_qty, 0),
    greatest(coalesce(s.usable_qty, 0) - coalesce(r.minimum_qty, 0), 0),
    coalesce(s.in_transfer_qty, 0),
    coalesce(s.pending_inspection_qty, 0),
    coalesce(s.damaged_qty, 0),
    coalesce(s.sample_qty, 0),
    coalesce(s.gift_qty, 0)
  from keys k
  left join stock s on s.location_id = k.location_id and s.product_id = k.product_id
  left join public.safety_stock_rules r on r.location_id = k.location_id and r.product_id = k.product_id
  where p_location_id is null or k.location_id = p_location_id
  order by k.location_id, k.product_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reconciliation (Admin): does the cache equal what the ledger says? Returns only mismatches.
-- reserved_qty is not derived from movements (it follows reservations, E05) so it is not compared.
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
    -- source side of outgoing movements
    select m.from_location_id as location_id, m.product_id, m.batch_id,
      -m.quantity as d_available,
      0 as d_in_transfer, 0 as d_pending,
      case when m.movement_type = 'DAMAGE_OUT' then m.quantity else 0 end as d_damaged,
      case when m.movement_type = 'SAMPLE_OUT' then m.quantity else 0 end as d_sample,
      case when m.movement_type = 'GIFT_OUT' then m.quantity else 0 end as d_gift
    from public.inventory_movements m
    where m.movement_type in ('SALE_OUT', 'DAMAGE_OUT', 'SAMPLE_OUT', 'GIFT_OUT', 'ADJUSTMENT_OUT', 'TRANSFER_OUT')
    union all
    -- destination side
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
  compared as (
    select coalesce(b.location_id, l.location_id) as location_id,
           coalesce(b.product_id, l.product_id) as product_id,
           coalesce(b.batch_id, l.batch_id) as batch_id,
           c.name, c.cached, c.ledger
    from public.inventory_balances b
    full join ledger l on l.location_id = b.location_id and l.product_id = b.product_id and l.batch_id = b.batch_id
    cross join lateral (values
      ('available_qty', coalesce(b.available_qty, 0), coalesce(l.available, 0)),
      ('in_transfer_qty', coalesce(b.in_transfer_qty, 0), coalesce(l.in_transfer, 0)),
      ('pending_inspection_qty', coalesce(b.pending_inspection_qty, 0), coalesce(l.pending, 0)),
      ('damaged_qty', coalesce(b.damaged_qty, 0), coalesce(l.damaged, 0)),
      ('sample_qty', coalesce(b.sample_qty, 0), coalesce(l.sample, 0)),
      ('gift_qty', coalesce(b.gift_qty, 0), coalesce(l.gift, 0))
    ) as c(name, cached, ledger)
  )
  select x.location_id, x.product_id, x.batch_id, x.name, x.cached::int, x.ledger::bigint
  from compared x
  where x.cached <> x.ledger;
end;
$$;

revoke all on function private.assert_location_active(uuid) from public, anon;
grant execute on function private.assert_location_active(uuid) to authenticated, service_role;

revoke all on function public.record_opening_stock(uuid, uuid, uuid, int, text) from public, anon;
revoke all on function public.adjust_inventory(text, uuid, uuid, uuid, int, text) from public, anon;
revoke all on function public.record_stock_exit(text, uuid, uuid, uuid, int, text) from public, anon;
revoke all on function public.inventory_summary(uuid) from public, anon;
revoke all on function public.verify_inventory_balances() from public, anon;
grant execute on function public.record_opening_stock(uuid, uuid, uuid, int, text) to authenticated;
grant execute on function public.adjust_inventory(text, uuid, uuid, uuid, int, text) to authenticated;
grant execute on function public.record_stock_exit(text, uuid, uuid, uuid, int, text) to authenticated;
grant execute on function public.inventory_summary(uuid) to authenticated;
grant execute on function public.verify_inventory_balances() to authenticated;
