-- DEL-011 (review RV-04/RV-05): bind the FEFO batch/quantity split to a delivery once, at its first
-- dispatch, and consume exactly that binding at DELIVERED. Also re-check that a batch is still
-- sellable (ACTIVE, not expired) right before dispatch and right before delivery.
--
-- RV-04: `delivery_detail`'s pick preview offset the FEFO queue by the *creation order* of sibling
-- deliveries, but `consume_order_item_stock` always took from the front of the ACTIVE reservation
-- queue regardless of which delivery was being delivered. Two deliveries of the same order
-- line/source confirmed DELIVERED out of creation order could book different batches than their
-- printed issue note, and reprinting after DELIVERED recomputed a live (possibly different) slice.
--
-- Fix: a delivery's goods physically leave the warehouse at its first dispatch (`dispatched_at`,
-- DEL-012). At that moment, and only that moment (dispatched_at stays immutable; a redispatch after
-- FAILED/reschedule never re-binds), commit the FEFO split into `delivery_item_batches`. The offset
-- used while binding is the real quantity other deliveries of the same line/source already hold in
-- logistics (`private.delivery_logistics_qty`'s own definition: OUT_FOR_DELIVERY/FAILED, not
-- DELIVERED/CANCELLED), not their creation order. `consume_order_item_stock` then consumes exactly
-- the bound rows. The pre-dispatch preview in `delivery_detail` (PREPARING/READY, dispatched_at is
-- null) is unchanged: nothing is committed yet, so it stays an estimate by creation order.
--
-- RV-05: FEFO allocation only checks a batch is ACTIVE and not expired at allocation time. Add
-- `private.assert_batch_sellable`, called for every batch about to be bound (dispatch) and again for
-- every bound batch right before it is posted as SALE_OUT (deliver). Either rejects atomically
-- (no reservation/balance change, no partial ledger entry); it never swaps to a different physical
-- batch. What should happen to a delivery whose bound batch expires/deactivates while already out for
-- delivery is not specified anywhere (no release/re-pick workflow, same posture as DEL-012's "kho
-- nhận lại" gap) — this migration only blocks the transition safely.

-- DEL-011 review correction: this migration is unreleased (local only). Preflight MUST precede
-- replacing delivery RPCs: no authoritative batch facts were recorded for historical in-flight
-- goods. Do not guess their physical batches from today's FEFO preview.
-- BEGIN UPGRADE PREFLIGHT
-- The locks below are retained through preflight, authoritative backfill and RPC replacement until
-- the migration's transaction ends. ACCESS EXCLUSIVE also drains legacy SELECT FOR UPDATE
-- transitions before inspecting data, preventing a first dispatch from slipping between the guard
-- and the new binding-aware RPC. A busy application fails safely after 10 seconds; apply during a
-- reviewed maintenance window and retry.
--
-- They are taken inside a DO block on purpose: the Supabase CLI sends a migration as a pipeline of
-- separate statements, which PostgreSQL does not treat as an explicit transaction block, so a
-- top-level `LOCK TABLE` fails there ("LOCK TABLE can only be used in transaction blocks",
-- SQLSTATE 25P01) and `db reset` stops at this file. Inside a function the same statements are
-- accepted both there and when the file is run in an explicit transaction (psql --single-transaction,
-- other runners). `set_config(..., true)` is the transaction-local `SET LOCAL`.
do $$
begin
  perform set_config('lock_timeout', '10s', true);
  lock table public.deliveries, public.delivery_items, public.inventory_movements
    in access exclusive mode;
end;
$$;
do $$
begin
  if exists (
    select 1 from public.deliveries
    where dispatched_at is not null and status not in ('DELIVERED', 'CANCELLED')
  ) then
    raise exception 'DEL-011 upgrade blocked: historical dispatched deliveries remain in logistics. Complete or reconcile their original batches under the existing workflow before applying this migration; do not guess batches from FEFO.';
  end if;
  if exists (
    select 1 from public.delivery_items di join public.deliveries d on d.id = di.delivery_id
    where d.status = 'DELIVERED' and di.quantity <> (
      select coalesce(sum(m.quantity), 0) from public.inventory_movements m
      where m.delivery_id = d.id and m.product_id = di.product_id
        and m.from_location_id = d.source_location_id and m.movement_type = 'SALE_OUT'
    )
  ) then
    raise exception 'DEL-011 upgrade blocked: completed delivery quantities do not match their SALE_OUT ledger. Reconcile the authoritative ledger before migration.';
  end if;
end;
$$;
-- END UPGRADE PREFLIGHT

-- ---------------------------------------------------------------------------
-- Table: the FEFO batch/quantity split actually committed to a delivery line, written once.
-- ---------------------------------------------------------------------------
create table public.delivery_item_batches (
  id uuid primary key default gen_random_uuid(),
  delivery_item_id uuid not null references public.delivery_items (id),
  batch_id uuid not null references public.product_batches (id),
  quantity int not null check (quantity > 0),
  created_at timestamptz not null default now(),
  constraint delivery_item_batches_unique unique (delivery_item_id, batch_id)
);

create index delivery_item_batches_item_idx on public.delivery_item_batches (delivery_item_id);
create index delivery_item_batches_batch_idx on public.delivery_item_batches (batch_id);

-- Written only by the binder below (same gate flag as inventory_balances/inventory_reservations);
-- never deleted, never updated outside that gate.
create or replace function private.delivery_item_batches_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa lô đã gán cho đợt giao.';
  end if;
  if coalesce(current_setting('app.inventory_posting', true), '') <> 'on' then
    raise exception 'Chỉ hệ thống được gán lô cho đợt giao khi xuất kho.';
  end if;
  return new;
end;
$$;

create trigger delivery_item_batches_guard_write
  before insert or update or delete on public.delivery_item_batches
  for each row execute function private.delivery_item_batches_guard();

revoke all on function private.delivery_item_batches_guard() from public, anon, authenticated;

alter table public.delivery_item_batches enable row level security;
revoke all on table public.delivery_item_batches from anon;
revoke insert, update, delete, truncate on table public.delivery_item_batches from authenticated;

-- Visible to whoever can see the delivery (order owner, Admin, Warehouse), same as delivery_items.
create policy delivery_item_batches_select on public.delivery_item_batches
  for select to authenticated
  using (exists (
    select 1 from public.delivery_items di join public.deliveries d on d.id = di.delivery_id
    where di.id = delivery_item_id
  ));

create trigger audit_delivery_item_batches after insert on public.delivery_item_batches
  for each row execute function private.audit_row_change();

-- BEGIN COMPLETED HISTORY BACKFILL
do $$
begin
  perform set_config('app.inventory_posting', 'on', true);
  insert into public.delivery_item_batches (delivery_item_id, batch_id, quantity)
  select di.id, m.batch_id, sum(m.quantity)::int
  from public.delivery_items di
  join public.deliveries d on d.id = di.delivery_id and d.status = 'DELIVERED'
  join public.inventory_movements m on m.delivery_id = d.id and m.product_id = di.product_id
    and m.from_location_id = d.source_location_id and m.movement_type = 'SALE_OUT'
  group by di.id, m.batch_id;
  perform set_config('app.inventory_posting', 'off', true);
end;
$$;
-- END COMPLETED HISTORY BACKFILL

-- ---------------------------------------------------------------------------
-- RV-05: is this batch still sellable right now?
-- ---------------------------------------------------------------------------
create or replace function private.assert_batch_sellable(p_batch_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_batch public.product_batches;
begin
  select * into v_batch from public.product_batches where id = p_batch_id;
  if not found then
    raise exception 'Không tìm thấy lô hàng.';
  end if;
  if v_batch.status <> 'ACTIVE' then
    raise exception 'Lô % đã ngừng dùng, không thể xuất/giao hàng từ lô này. Đơn cần được phân bổ lại.',
      v_batch.batch_code using errcode = 'P0001';
  end if;
  if v_batch.expiry_date < private.business_today() then
    raise exception 'Lô % đã hết hạn sử dụng (HSD %), không thể xuất/giao hàng từ lô này. Đơn cần được phân bổ lại.',
      v_batch.batch_code, v_batch.expiry_date using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RV-04: commit the FEFO split for a delivery, once, at its first dispatch.
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
  v_res record;
  v_offset int;
  v_cursor int;
  v_remaining int;
  v_row_start int;
  v_take int;
begin
  select * into v_delivery from public.deliveries where id = p_delivery_id;

  for v_item in select * from public.delivery_items where delivery_id = p_delivery_id order by order_item_id loop
    -- Units of this order line, at this source, already committed to another delivery whose goods
    -- are still in logistics (same filter as private.delivery_logistics_qty): the real FEFO position
    -- already taken, not a guess by creation order.
    select coalesce(sum(dib.quantity), 0)::int into v_offset
    from public.delivery_item_batches dib
    join public.delivery_items di2 on di2.id = dib.delivery_item_id
    join public.deliveries d2 on d2.id = di2.delivery_id
    where di2.order_item_id = v_item.order_item_id
      and d2.source_location_id = v_delivery.source_location_id
      and d2.id <> p_delivery_id
      and d2.dispatched_at is not null and d2.status not in ('DELIVERED', 'CANCELLED');

    v_cursor := 0;
    v_remaining := v_item.quantity;

    for v_res in
      select r.id, r.batch_id, r.quantity
      from public.inventory_reservations r
      join public.product_batches pb on pb.id = r.batch_id
      where r.order_item_id = v_item.order_item_id and r.location_id = v_delivery.source_location_id
        and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'
      order by pb.expiry_date, pb.manufactured_date, r.id
      for update of r
    loop
      exit when v_remaining <= 0;
      v_row_start := v_cursor;
      v_cursor := v_cursor + v_res.quantity;
      continue when v_cursor <= v_offset;

      v_take := least(v_cursor - greatest(v_row_start, v_offset), v_remaining);
      if v_take > 0 then
        perform private.assert_batch_sellable(v_res.batch_id);

        perform set_config('app.inventory_posting', 'on', true);
        insert into public.delivery_item_batches (delivery_item_id, batch_id, quantity)
        values (v_item.id, v_res.batch_id, v_take)
        on conflict (delivery_item_id, batch_id) do update
          set quantity = public.delivery_item_batches.quantity + excluded.quantity;
        perform set_config('app.inventory_posting', 'off', true);

        v_remaining := v_remaining - v_take;
      end if;
    end loop;

    if v_remaining > 0 then
      -- Unreachable if assert_delivery_stock (same reserved/logistics accounting) already passed;
      -- kept as a safety net with the same message the caller already uses for that check.
      raise exception 'Chưa đủ hàng đã phân bổ tại kho xuất của đợt giao này (thiếu %). Hãy phân bổ hàng cho đơn tại đúng kho xuất.', v_remaining
        using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

revoke all on function private.assert_batch_sellable(uuid), private.bind_delivery_item_batches(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Stock consumption when a delivery is DELIVERED: consume exactly the bound batches (RV-04), and
-- re-check each one is still sellable right before it is posted (RV-05).
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
  v_delivery_item_id uuid;
  v_bind record;
  v_res record;
  v_bind_take int;
  v_res_take int;
  v_remaining int := p_qty;
  v_close_remaining int;
begin
  select * into v_item from public.order_items where id = p_order_item_id for update;

  select di.id into v_delivery_item_id
  from public.delivery_items di
  where di.delivery_id = p_delivery_id and di.order_item_id = p_order_item_id;

  if v_delivery_item_id is null then
    raise exception 'Đợt giao không có dòng sản phẩm này.';
  end if;

  -- Posting order follows the batch's own FEFO key (expiry, then manufacture date), not insertion
  -- time: created_at is frozen at the start of this transaction (now()), so several rows bound in the
  -- same dispatch/deliver call would otherwise tie and sort arbitrarily by id.
  for v_bind in
    select dib.batch_id, dib.quantity
    from public.delivery_item_batches dib
    join public.product_batches pb on pb.id = dib.batch_id
    where dib.delivery_item_id = v_delivery_item_id
    order by pb.expiry_date, pb.manufactured_date, dib.id
  loop
    exit when v_remaining <= 0;
    v_bind_take := least(v_bind.quantity, v_remaining);

    -- RV-05: re-check right before the goods are credited as delivered, not just at dispatch.
    perform private.assert_batch_sellable(v_bind.batch_id);

    perform private.post_inventory_movement(
      'SALE_OUT', v_item.product_id, v_bind.batch_id, p_location_id, null, v_bind_take,
      'Giao hàng cho khách', v_item.order_id, null, null, null, p_delivery_id, true);

    -- Close/trim exactly the reservation(s) of this bound batch (bookkeeping only; the posting
    -- function above already moved available/reserved for it).
    v_close_remaining := v_bind_take;
    for v_res in
      select r.* from public.inventory_reservations r
      where r.order_item_id = p_order_item_id and r.location_id = p_location_id and r.batch_id = v_bind.batch_id
        and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION'
      order by r.id
      for update of r
    loop
      exit when v_close_remaining <= 0;
      v_res_take := least(v_res.quantity, v_close_remaining);
      perform set_config('app.inventory_posting', 'on', true);
      if v_res_take = v_res.quantity then
        update public.inventory_reservations
        set status = 'CONSUMED', released_at = now(), release_reason = 'Đã giao hàng'
        where id = v_res.id;
      else
        update public.inventory_reservations set quantity = quantity - v_res_take where id = v_res.id;
        insert into public.inventory_reservations (
          order_id, order_item_id, location_id, product_id, batch_id, quantity, reservation_type,
          status, reserved_at, released_at, release_reason
        ) values (
          v_res.order_id, v_res.order_item_id, v_res.location_id, v_res.product_id, v_res.batch_id, v_res_take,
          'PHYSICAL_ALLOCATION', 'CONSUMED', v_res.reserved_at, now(), 'Đã giao hàng');
      end if;
      perform set_config('app.inventory_posting', 'off', true);
      v_close_remaining := v_close_remaining - v_res_take;
    end loop;

    if v_close_remaining > 0 then
      raise exception 'Dữ liệu giữ hàng không khớp với lô đã gán cho đợt giao (thiếu %). Vui lòng liên hệ Admin.', v_close_remaining;
    end if;

    v_remaining := v_remaining - v_bind_take;
  end loop;

  if v_remaining > 0 then
    raise exception 'Đợt giao chưa gán đủ lô hàng cho dòng sản phẩm này (thiếu %). Hãy xuất kho lại đợt giao.', v_remaining
      using errcode = 'P0001';
  end if;

  update public.order_items
  set delivered_quantity = delivered_quantity + p_qty, allocated_quantity = allocated_quantity - p_qty
  where id = p_order_item_id;
end;
$$;

-- transition_delivery: dispatch now also binds the FEFO split, once, the first time a delivery
-- leaves the warehouse (guarded by dispatched_at being null before this transition; a redispatch
-- after FAILED/reschedule reuses the existing rows, same as the DEL-012 logistics hold).
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
  -- both claim the same reserved units (or the same FEFO position while binding).
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
    if v_delivery.dispatched_at is null then
      -- First dispatch: commit the FEFO batch/quantity split (RV-04) after re-checking it is still
      -- sellable (RV-05). A redispatch (dispatched_at already set) reuses the existing rows.
      perform private.bind_delivery_item_batches(p_delivery_id);
    end if;
    -- Every dispatch, including FAILED -> READY redispatch, validates the committed physical
    -- batches. Never rebind goods which already left the warehouse.
    for v_item in
      select distinct dib.batch_id from public.delivery_item_batches dib
      join public.delivery_items di on di.id = dib.delivery_item_id
      where di.delivery_id = p_delivery_id
      order by dib.batch_id
    loop
      perform private.assert_batch_sellable(v_item.batch_id);
    end loop;
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
    -- The goods stay in logistics: no reservation, balance or binding is touched (TECH_DESIGN §7).
    update public.deliveries set status = 'FAILED', failed_reason = v_reason where id = p_delivery_id returning * into v_delivery;

  else
    raise exception 'Thao tác không hợp lệ: %', p_action;
  end if;
  return v_delivery;
end;
$$;

-- delivery_detail: once a delivery has left the warehouse (dispatched_at is not null), the pick list
-- is the recorded binding (a fact, stable through reprints, including after DELIVERED). Before that
-- (PREPARING/READY) nothing is committed yet, so it stays the existing live FEFO preview by creation
-- order, unchanged.
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
        'pick', case
          when v_delivery.dispatched_at is not null then
            -- Recorded fact: exactly what was bound at dispatch and consumed at delivery.
            (select coalesce(jsonb_agg(jsonb_build_object(
                        'batch_code', pb.batch_code, 'expiry_date', pb.expiry_date, 'quantity', dib.quantity)
                      order by pb.expiry_date, pb.manufactured_date, dib.id), '[]'::jsonb)
               from public.delivery_item_batches dib join public.product_batches pb on pb.id = dib.batch_id
               where dib.delivery_item_id = di.id)
          else
            -- Not yet dispatched: a live preview (the same offset-by-creation-order slice as before).
            (select coalesce(jsonb_agg(jsonb_build_object(
                        'batch_code', x.batch_code, 'expiry_date', x.expiry_date, 'quantity', x.take)
                      order by x.expiry_date, x.manufactured_date, x.reservation_id), '[]'::jsonb)
               from (
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
        end
      ) order by p.sku), '[]'::jsonb)
      from public.delivery_items di join public.products p on p.id = di.product_id where di.delivery_id = p_delivery_id
    )
  );
end;
$$;
-- transition_delivery and delivery_detail keep their existing grants (create or replace preserves them).
