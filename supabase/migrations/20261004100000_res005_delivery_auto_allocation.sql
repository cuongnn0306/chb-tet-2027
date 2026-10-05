-- RES-005: configurable allocation lead time drives automatic physical allocation by delivery date.
--
--   * Physical allocation is due when scheduled_date - allocation_lead_days <= the business day (Vietnam).
--   * The job reuses the trusted DEL-005 engine (per delivery / line / source location, FEFO, safety stock,
--     no negative stock, audit). Nothing is bypassed: the engine below the permission check of
--     public.allocate_delivery_stock is factored into a private core that both callers use.
--   * Additive: public.allocate_delivery_stock keeps its signature, authorization and results.

-- ---------------------------------------------------------------------------
-- Shared engine: the former body of public.allocate_delivery_stock after its permission checks.
-- p_actor is the user to record (NULL for the system job); p_note prefixes the audit reason.
-- ---------------------------------------------------------------------------
create or replace function private.allocate_delivery_stock_core(
  p_delivery_id uuid,
  p_allow_below_safety boolean,
  p_actor uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  v_reason := coalesce(p_note || ': ', '')
    || 'Phân bổ hàng cho đợt giao ' || v_delivery.delivery_code || ' tại kho ' || v_loc.code;
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
      values (p_delivery_id, v_line.order_item_id, v_delivery.source_location_id, v_taken, p_actor);
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
    values (p_actor, 'deliveries', v_delivery.id, 'allocate_stock', null, v_result, v_reason);
  end if;
  return v_result;
end;
$$;

-- The manual RPC: same signature, authorization and results; only the engine moved.
create or replace function public.allocate_delivery_stock(
  p_delivery_id uuid,
  p_allow_below_safety boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['ADMIN', 'WAREHOUSE']) then
    raise exception 'Chỉ Admin hoặc Kho được phân bổ hàng cho đợt giao.' using errcode = '42501';
  end if;
  if p_allow_below_safety and not private.is_admin() then
    raise exception 'Chỉ Admin được phép dùng tồn an toàn.' using errcode = '42501';
  end if;
  return private.allocate_delivery_stock_core(p_delivery_id, p_allow_below_safety, (select auth.uid()), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Evidence: one immutable audit row per distinct automatic outcome of a delivery. The signature of the
-- newest evidence is compared first, so an unchanged shortage/failure is not written again every run.
-- ---------------------------------------------------------------------------
create or replace function private.log_auto_allocation_evidence(
  p_delivery_id uuid,
  p_action text,
  p_signature jsonb,
  p_data jsonb,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last jsonb;
begin
  select a.after_data -> 'signature' into v_last
  from public.audit_logs a
  where a.entity_type = 'deliveries' and a.entity_id = p_delivery_id
    and a.action in ('auto_allocate_shortage', 'auto_allocate_failed', 'allocate_stock')
  order by a.created_at desc, a.id desc
  limit 1;

  if v_last is not null and v_last = p_signature then
    return false;
  end if;
  insert into public.audit_logs (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (null, 'deliveries', p_delivery_id, p_action, null, p_data || jsonb_build_object('signature', p_signature), p_reason);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- The job: allocate every open delivery whose lead time has arrived.
-- ---------------------------------------------------------------------------
create or replace function private.allocate_due_deliveries(p_as_of date default private.business_today())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text;
  v_lead int;
  v_cand record;
  v_del public.deliveries;
  v_ostatus text;
  v_res jsonb;
  v_sig jsonb;
  v_input jsonb;
  v_checked jsonb;
  v_note text;
  v_items jsonb := '[]'::jsonb;
  v_outcome text;
  v_n_alloc int := 0;
  v_n_covered int := 0;
  v_n_short int := 0;
  v_n_skip int := 0;
  v_n_fail int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('res005.allocate_due_deliveries', 0)) then
    return jsonb_build_object('status', 'busy', 'as_of', p_as_of);
  end if;

  select value #>> '{}' into v_raw from public.app_settings where key = 'allocation_lead_days';
  if v_raw is null or v_raw !~ '^[0-9]{1,3}$' then
    raise exception 'Chưa cấu hình số ngày phân bổ hàng trước ngày giao. Admin vui lòng thiết lập "Phân bổ hàng trước ngày giao" trong Cấu hình hệ thống.'
      using errcode = 'P0001';
  end if;
  v_lead := v_raw::int;

  for v_cand in
    select d.id
    from public.deliveries d
    join public.orders o on o.id = d.order_id
    where d.status in ('PREPARING', 'READY') and d.dispatched_at is null
      and d.scheduled_date <= p_as_of + v_lead
      and o.status in ('CONFIRMED', 'RESERVED', 'PREPARING', 'WAITING_DELIVERY')
    order by d.scheduled_date, d.scheduled_time nulls last, d.created_at, d.id
  loop
    v_outcome := null;
    begin
      select * into v_del from public.deliveries where id = v_cand.id for update skip locked;
      if not found then
        v_outcome := 'skipped_locked';
      else
        select o.status into v_ostatus from public.orders o where o.id = v_del.order_id;
        if v_del.status not in ('PREPARING', 'READY') or v_del.dispatched_at is not null
           or v_del.scheduled_date > p_as_of + v_lead
           or v_ostatus not in ('CONFIRMED', 'RESERVED', 'PREPARING', 'WAITING_DELIVERY') then
          v_outcome := 'skipped_not_eligible';
        end if;
      end if;

      if v_outcome is null then
        v_note := 'Tự động theo thời hạn phân bổ ' || v_lead || ' ngày trước ngày giao '
          || to_char(v_del.scheduled_date, 'DD/MM/YYYY');
        v_res := private.allocate_delivery_stock_core(v_del.id, false, null, v_note);

        if (v_res ->> 'fully_allocated')::boolean then
          if (v_res ->> 'allocated_total')::int > 0 or (v_res ->> 'released_total')::int > 0 then
            v_outcome := 'allocated';
          else
            v_outcome := 'already_covered';
          end if;
        else
          v_outcome := 'shortage';
          v_sig := jsonb_build_object(
            'kind', 'shortage', 'location_id', v_res -> 'location_id', 'shortage_total', v_res -> 'shortage_total',
            'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                        'order_item_id', l -> 'order_item_id', 'requested', l -> 'requested', 'shortage', l -> 'shortage')
                        order by l ->> 'order_item_id'), '[]'::jsonb)
                      from jsonb_array_elements(v_res -> 'lines') l));
          select coalesce(jsonb_agg(jsonb_build_object(
                   'product_id', l -> 'product_id', 'quantity', l -> 'requested', 'covered', 0)), '[]'::jsonb)
          into v_input
          from jsonb_array_elements(v_res -> 'lines') l
          where (l ->> 'requested')::int > 0;
          v_checked := private.stock_check_lines(v_del.source_location_id, v_input);
          perform private.log_auto_allocation_evidence(
            v_del.id, 'auto_allocate_shortage', v_sig,
            v_res || jsonb_build_object(
              'lead_days', v_lead, 'due_from', v_del.scheduled_date - v_lead, 'stock_check', v_checked),
            'Chưa đủ hàng để tự động phân bổ cho đợt giao ' || v_del.delivery_code
              || ' (thiếu ' || (v_res ->> 'shortage_total') || '). Cần chuyển hàng hoặc sản xuất thêm.');
        end if;
      end if;
    exception when others then
      v_outcome := 'failed';
      v_sig := jsonb_build_object('kind', 'failed', 'message', sqlerrm);
      perform private.log_auto_allocation_evidence(
        v_cand.id, 'auto_allocate_failed', v_sig,
        jsonb_build_object('lead_days', v_lead, 'sqlstate', sqlstate, 'message', sqlerrm),
        'Không tự động phân bổ được hàng cho đợt giao: ' || sqlerrm);
    end;

    v_items := v_items || jsonb_build_object('delivery_id', v_cand.id, 'outcome', v_outcome);
    case v_outcome
      when 'allocated' then v_n_alloc := v_n_alloc + 1;
      when 'already_covered' then v_n_covered := v_n_covered + 1;
      when 'shortage' then v_n_short := v_n_short + 1;
      when 'failed' then v_n_fail := v_n_fail + 1;
      else v_n_skip := v_n_skip + 1;
    end case;
  end loop;

  return jsonb_build_object(
    'status', 'done', 'as_of', p_as_of, 'lead_days', v_lead,
    'allocated', v_n_alloc, 'already_covered', v_n_covered, 'shortage', v_n_short,
    'skipped', v_n_skip, 'failed', v_n_fail, 'deliveries', v_items);
end;
$$;

revoke all on function private.allocate_delivery_stock_core(uuid, boolean, uuid, text),
  private.log_auto_allocation_evidence(uuid, text, jsonb, jsonb, text),
  private.allocate_due_deliveries(date) from public, anon, authenticated;

-- Admin wrapper (like release_expired_reservations): run the job now.
create or replace function public.run_due_delivery_allocation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Chỉ Admin được chạy phân bổ hàng theo ngày giao.' using errcode = '42501';
  end if;
  return private.allocate_due_deliveries();
end;
$$;

revoke all on function public.run_due_delivery_allocation() from public, anon;
grant execute on function public.run_due_delivery_allocation() to authenticated;

-- ---------------------------------------------------------------------------
-- Schedule the job hourly when pg_cron is available (same guarded pattern as RES-003). Without the
-- extension the Admin wrapper above still runs it.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'allocate-due-deliveries';
    perform cron.schedule('allocate-due-deliveries', '7 * * * *', 'select private.allocate_due_deliveries()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end;
$$;
