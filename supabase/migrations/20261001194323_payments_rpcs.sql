-- PAY-002, PAY-003, PAY-005 (data), PAY-007, PAY-008, PAY-010: payment actions, deposit policy,
-- payment instructions for the QR, idempotent SePay webhook processing, review queue.
--
-- Deposit policy (PRD §18, never hard-coded): settings default_deposit_type (PERCENT | FIXED_AMOUNT)
-- and default_deposit_value. deposit_required is fixed when an Admin confirms an order into
-- WAITING_DEPOSIT; the order becomes CONFIRMED the moment confirmed payments cover it.

-- ---------------------------------------------------------------------------
-- Deposit policy engine (PAY-003)
-- ---------------------------------------------------------------------------
create or replace function private.compute_deposit(p_net_amount bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_value text;
  v_deposit numeric;
begin
  select value #>> '{}' into v_type from public.app_settings where key = 'default_deposit_type';
  select value #>> '{}' into v_value from public.app_settings where key = 'default_deposit_value';
  if v_type is null or v_value is null then
    raise exception 'Chưa cấu hình chính sách cọc. Admin vui lòng thiết lập "Kiểu tiền cọc" và "Giá trị tiền cọc" trong Cấu hình hệ thống.'
      using errcode = 'P0001';
  end if;

  v_deposit := case v_type
    when 'PERCENT' then ceil(p_net_amount * least(v_value::numeric, 100) / 100.0)   -- round up: never below the policy
    when 'FIXED_AMOUNT' then v_value::numeric
    else null
  end;
  if v_deposit is null then
    raise exception 'Kiểu tiền cọc không hợp lệ: %', v_type using errcode = 'P0001';
  end if;
  return least(greatest(v_deposit, 0), p_net_amount)::bigint;   -- never more than the order
end;
$$;

-- Moves a WAITING_DEPOSIT order to CONFIRMED once confirmed payments cover the deposit.
create or replace function private.apply_deposit_rule(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if found and v_order.status = 'WAITING_DEPOSIT' and v_order.paid_amount >= v_order.deposit_required then
    perform set_config('app.audit_reason', 'Đã đủ tiền cọc', true);
    update public.orders set status = 'CONFIRMED', confirmed_at = now() where id = p_order_id;
    perform set_config('app.audit_reason', '', true);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- paid_amount and deposit_required are derived: only the payment functions may change them
-- (same pattern as the inventory cache). Everything else in the order guard is unchanged.
-- ---------------------------------------------------------------------------
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

  if (new.paid_amount is distinct from old.paid_amount or new.deposit_required is distinct from old.deposit_required)
     and coalesce(current_setting('app.payment_posting', true), '') <> 'on' then
    raise exception 'Không được sửa số tiền đã thanh toán hay tiền cọc trực tiếp. Hãy ghi nhận thanh toán.';
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

revoke all on function private.orders_guard() from public, anon, authenticated;

-- Trigger names start with "zz" on purpose: they must fire AFTER the status-history and
-- reservation triggers of the same update so the timeline stays in order.
create or replace function private.orders_deposit_hook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'WAITING_DEPOSIT' and old.status is distinct from 'WAITING_DEPOSIT' then
    perform set_config('app.payment_posting', 'on', true);
    update public.orders set deposit_required = private.compute_deposit(new.net_amount) where id = new.id;
    perform set_config('app.payment_posting', 'off', true);
    perform private.apply_deposit_rule(new.id);
  end if;
  return null;
end;
$$;

create trigger orders_zz_deposit_rule
  after update of status on public.orders
  for each row execute function private.orders_deposit_hook();

create or replace function private.payments_deposit_hook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'CONFIRMED' then
    perform private.apply_deposit_rule(new.order_id);
  end if;
  return null;
end;
$$;

create trigger payments_zz_deposit_rule
  after insert or update of status on public.payments
  for each row execute function private.payments_deposit_hook();

revoke all on function private.compute_deposit(bigint), private.apply_deposit_rule(uuid),
  private.orders_deposit_hook(), private.payments_deposit_hook() from public, anon, authenticated;

-- The reservation hook runs before the deposit hook; if the deposit rule already moved the order on
-- (deposit 0 or paid earlier), the temporary hold must not be taken after the fact.
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

-- transition_order again, returning the order AFTER all triggers ran (an Admin confirm can now end in
-- CONFIRMED straight away, and deposit_required is set by a trigger).
create or replace function public.transition_order(
  p_order_id uuid,
  p_action text,
  p_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean := private.is_admin();
  v_order public.orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ceiling bigint;
  v_new text;
begin
  if not private.can_create_orders() then
    raise exception 'Bạn không có quyền thao tác đơn hàng.' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not (v_admin or v_order.owner_user_id = v_uid or v_order.created_by = v_uid) then
    raise exception 'Không tìm thấy đơn hàng hoặc bạn không có quyền thao tác đơn này.';
  end if;

  if p_action = 'submit' then
    if v_order.status <> 'DRAFT' then
      raise exception 'Chỉ gửi được đơn nháp.';
    end if;
    if not exists (select 1 from public.order_items where order_id = v_order.id) then
      raise exception 'Đơn hàng cần có ít nhất một sản phẩm trước khi gửi.';
    end if;
    -- Commission rates may have changed since the draft was saved: check the ceiling again.
    select private.discount_ceiling(array_agg(i.gross_line_amount),
             array_agg(private.resolve_commission_rate(v_order.owner_user_id, i.product_id, private.business_today())))
      into v_ceiling
    from public.order_items i where i.order_id = v_order.id;
    if v_order.discount_amount > v_ceiling then
      raise exception 'Giảm giá hiện vượt mức hoa hồng cho phép (tối đa % đ). Vui lòng sửa lại đơn nháp.', v_ceiling;
    end if;
    v_new := 'WAITING_CONFIRMATION';

  elsif p_action = 'return_to_draft' then
    if v_order.status <> 'WAITING_CONFIRMATION' then
      raise exception 'Chỉ đưa được về nháp khi đơn đang chờ xác nhận.';
    end if;
    if v_order.paid_amount > 0 then
      raise exception 'Đơn đã có thanh toán nên không thể đưa về nháp.';
    end if;
    v_new := 'DRAFT';

  elsif p_action = 'confirm' then
    if not v_admin then
      raise exception 'Chỉ Admin được xác nhận đơn.' using errcode = '42501';
    end if;
    if v_order.status <> 'WAITING_CONFIRMATION' then
      raise exception 'Chỉ xác nhận được đơn đang chờ xác nhận.';
    end if;
    v_new := 'WAITING_DEPOSIT';

  elsif p_action = 'cancel' then
    if v_reason is null then
      raise exception 'Vui lòng nhập lý do hủy đơn.';
    end if;
    if v_order.status not in ('DRAFT', 'WAITING_CONFIRMATION', 'WAITING_DEPOSIT', 'CONFIRMED', 'RESERVED') then
      raise exception 'Đơn ở trạng thái % không thể hủy.', v_order.status;
    end if;
    if v_order.status in ('CONFIRMED', 'RESERVED') and not v_admin then
      raise exception 'Đơn đã xác nhận chỉ Admin được hủy.' using errcode = '42501';
    end if;
    if v_order.paid_amount > 0 then
      raise exception 'Đơn đã có thanh toán. Cần hoàn/hủy thanh toán trước khi hủy đơn.';
    end if;
    -- Releasing temporary reservations is added with E05 (reservations do not exist yet).
    v_new := 'CANCELLED';

  elsif p_action = 'void' then
    if not v_admin then
      raise exception 'Chỉ Admin được vô hiệu hóa đơn.' using errcode = '42501';
    end if;
    if v_reason is null then
      raise exception 'Vui lòng nhập lý do vô hiệu hóa đơn.';
    end if;
    if v_order.status not in ('DRAFT', 'WAITING_CONFIRMATION', 'WAITING_DEPOSIT', 'CONFIRMED') then
      raise exception 'Đơn ở trạng thái % không thể vô hiệu hóa.', v_order.status;
    end if;
    if v_order.paid_amount > 0 then
      raise exception 'Đơn đã có thanh toán. Cần hoàn/hủy thanh toán trước khi vô hiệu hóa đơn.';
    end if;
    v_new := 'VOIDED';

  else
    raise exception 'Thao tác không hợp lệ: %', p_action;
  end if;

  -- The reason is picked up by the status history and audit triggers in this transaction.
  perform set_config('app.audit_reason', coalesce(v_reason, ''), true);

  update public.orders set
    status = v_new,
    cancelled_at = case when v_new = 'CANCELLED' then now() else cancelled_at end,
    cancel_reason = case when v_new = 'CANCELLED' then v_reason else cancel_reason end,
    voided_at = case when v_new = 'VOIDED' then now() else voided_at end,
    void_reason = case when v_new = 'VOIDED' then v_reason else void_reason end
  where id = v_order.id
  returning * into v_order;

  perform set_config('app.audit_reason', '', true);

  -- Triggers (deposit rule, reservations) may have changed the order further: return the final row.
  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin actions (PAY-002, PAY-010). "Xác nhận thanh toán" and refunds are Admin-only (matrix).
-- ---------------------------------------------------------------------------
create or replace function private.assert_admin_payments()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Chỉ Admin được ghi nhận, xác nhận hoặc hoàn thanh toán.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.record_payment(
  p_order_id uuid,
  p_method text,
  p_amount bigint,
  p_note text default null,
  p_confirm boolean default true,
  p_transfer_content text default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  perform private.assert_admin_payments();
  if p_amount is null or p_amount <= 0 then
    raise exception 'Số tiền phải lớn hơn 0.';
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'Không tìm thấy đơn hàng.';
  end if;

  insert into public.payments (
    order_id, payment_code, method, amount, status, transfer_content, note, paid_at, confirmed_by, created_by
  ) values (
    p_order_id, '', p_method, p_amount,
    case when p_confirm then 'CONFIRMED' else 'PENDING' end,
    nullif(btrim(coalesce(p_transfer_content, '')), ''), nullif(btrim(coalesce(p_note, '')), ''),
    case when p_confirm then now() end,
    case when p_confirm then (select auth.uid()) end,
    (select auth.uid())
  ) returning * into v_payment;
  return v_payment;
end;
$$;

create or replace function public.confirm_payment(p_payment_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
begin
  perform private.assert_admin_payments();
  update public.payments
  set status = 'CONFIRMED', paid_at = coalesce(paid_at, now()), confirmed_by = (select auth.uid())
  where id = p_payment_id and status = 'PENDING'
  returning * into v_payment;
  if not found then
    raise exception 'Không tìm thấy khoản thanh toán đang chờ xác nhận.';
  end if;
  return v_payment;
end;
$$;

-- fail (PENDING -> FAILED), void (PENDING -> VOIDED), refund (CONFIRMED -> REFUNDED): reason required.
create or replace function private.close_payment(p_payment_id uuid, p_from text, p_to text, p_reason text)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.assert_admin_payments();
  if v_reason is null then
    raise exception 'Vui lòng nhập lý do.';
  end if;
  update public.payments
  set status = p_to, status_reason = v_reason
  where id = p_payment_id and status = p_from
  returning * into v_payment;
  if not found then
    raise exception 'Không tìm thấy khoản thanh toán ở trạng thái % để thực hiện thao tác này.', p_from;
  end if;
  return v_payment;
end;
$$;

create or replace function public.fail_payment(p_payment_id uuid, p_reason text)
returns public.payments language sql security definer set search_path = '' as $$
  select * from private.close_payment(p_payment_id, 'PENDING', 'FAILED', p_reason)
$$;

create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns public.payments language sql security definer set search_path = '' as $$
  select * from private.close_payment(p_payment_id, 'PENDING', 'VOIDED', p_reason)
$$;

create or replace function public.refund_payment(p_payment_id uuid, p_reason text)
returns public.payments language sql security definer set search_path = '' as $$
  select * from private.close_payment(p_payment_id, 'CONFIRMED', 'REFUNDED', p_reason)
$$;

-- ---------------------------------------------------------------------------
-- PAY-004 / PAY-005: what the customer must pay and how (for the QR on the order screen).
-- Only public bank details from the sepay_config setting are returned (that setting must never hold secrets).
-- ---------------------------------------------------------------------------
create or replace function public.payment_instructions(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_uid uuid := (select auth.uid());
  v_config jsonb;
  v_due bigint;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found
     or not (private.is_admin() or (private.can_create_orders() and (v_order.owner_user_id = v_uid or v_order.created_by = v_uid))) then
    raise exception 'Không tìm thấy đơn hàng hoặc bạn không có quyền xem.';
  end if;

  select value into v_config from public.app_settings where key = 'sepay_config';

  -- While waiting for the deposit the customer pays the deposit; afterwards, whatever remains.
  v_due := case
    when v_order.status = 'WAITING_DEPOSIT' then greatest(v_order.deposit_required - v_order.paid_amount, 0)
    else greatest(v_order.net_amount - v_order.paid_amount, 0)
  end;

  return jsonb_build_object(
    'order_code', v_order.order_code,
    'transfer_content', v_order.order_code,
    'status', v_order.status,
    'net_amount', v_order.net_amount,
    'deposit_required', v_order.deposit_required,
    'paid_amount', v_order.paid_amount,
    'remaining_amount', greatest(v_order.net_amount - v_order.paid_amount, 0),
    'amount_due', v_due,
    'reservation_expires_at', v_order.reservation_expires_at,
    'configured', v_config is not null and (v_config ->> 'account_no') is not null and (v_config ->> 'bank') is not null,
    'bank', v_config ->> 'bank',
    'account_no', v_config ->> 'account_no',
    'account_name', v_config ->> 'account_name'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- PAY-007 / PAY-008: SePay webhook processing. Called ONLY by the Edge Function with the service role,
-- after it has authenticated the request. Idempotent: the same provider event is applied at most once.
--   outcome CREDITED      matched order, amount fits: a CONFIRMED payment was created
--   outcome NEEDS_REVIEW  matched order, but the order cannot take it or the amount is too high:
--                         recorded as PENDING for an Admin to decide (never silently credited)
--   outcome UNMATCHED     no order for the payment code: logged for an Admin to assign
--   outcome DUPLICATE     the provider event was already processed (a retry): nothing changes
--   outcome IGNORED       money going out, or an unusable amount
-- ---------------------------------------------------------------------------
create or replace function private.process_sepay_event(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_provider constant text := 'SEPAY';
  v_event_id text := nullif(btrim(coalesce(p_payload ->> 'id', '')), '');
  v_event public.payment_events;
  v_existing text;
  v_amount numeric;
  v_code text;
  v_prefix text;
  v_text text;
  v_order public.orders;
  v_payment public.payments;
  v_paid_at timestamptz;
  v_content text := nullif(btrim(coalesce(p_payload ->> 'content', p_payload ->> 'description', '')), '');
  v_outcome text;
  v_note text;
begin
  if v_event_id is null then
    raise exception 'Webhook thiếu mã giao dịch (id).' using errcode = 'P0001';
  end if;

  -- Layer 1: one log row per provider event. A concurrent duplicate waits here for the first
  -- transaction, then sees the conflict and returns DUPLICATE.
  insert into public.payment_events (provider, provider_event_id, payload)
  values (c_provider, v_event_id, p_payload)
  on conflict (provider, provider_event_id) do nothing
  returning * into v_event;

  if v_event.id is null then
    select outcome into v_existing from public.payment_events
    where provider = c_provider and provider_event_id = v_event_id;
    return jsonb_build_object('status', 'DUPLICATE', 'previous_outcome', v_existing);
  end if;

  if lower(coalesce(p_payload ->> 'transferType', 'in')) <> 'in' then
    update public.payment_events set outcome = 'IGNORED', note = 'Giao dịch tiền ra, bỏ qua.' where id = v_event.id;
    return jsonb_build_object('status', 'IGNORED');
  end if;

  if jsonb_typeof(p_payload -> 'transferAmount') <> 'number' or (p_payload ->> 'transferAmount') !~ '^[0-9]{1,13}$'
     or (p_payload ->> 'transferAmount')::numeric <= 0 then
    update public.payment_events set outcome = 'IGNORED', note = 'Số tiền không hợp lệ.' where id = v_event.id;
    return jsonb_build_object('status', 'IGNORED');
  end if;
  v_amount := (p_payload ->> 'transferAmount')::numeric;

  -- Find the payment code: the provider's own "code" field first, then the transfer content.
  v_code := upper(btrim(coalesce(p_payload ->> 'code', '')));
  if v_code = '' or not exists (select 1 from public.orders where order_code = v_code) then
    select value #>> '{}' into v_prefix from public.app_settings where key = 'order_prefix';
    if v_prefix ~ '^[A-Z]{1,10}$' then
      v_text := coalesce(p_payload ->> 'content', '') || ' ' || coalesce(p_payload ->> 'description', '');
      v_code := upper(coalesce(substring(v_text from '(?i)(' || v_prefix || '[0-9]{6,})'), ''));
    end if;
  end if;

  select * into v_order from public.orders where order_code = v_code for update;
  if not found then
    update public.payment_events set outcome = 'UNMATCHED',
      note = 'Không tìm thấy đơn hàng cho mã thanh toán "' || coalesce(nullif(v_code, ''), '—') || '".'
    where id = v_event.id;
    return jsonb_build_object('status', 'UNMATCHED');
  end if;

  begin
    v_paid_at := ((p_payload ->> 'transactionDate')::timestamp at time zone 'Asia/Ho_Chi_Minh');
  exception when others then
    v_paid_at := now();
  end;

  if v_order.status in ('DRAFT', 'CANCELLED', 'VOIDED', 'RETURNED', 'EXCHANGED')
     or v_amount > v_order.net_amount - v_order.paid_amount then
    v_outcome := 'NEEDS_REVIEW';
    v_note := case
      when v_order.status in ('DRAFT', 'CANCELLED', 'VOIDED', 'RETURNED', 'EXCHANGED')
        then 'Đơn ở trạng thái ' || v_order.status || ' không nhận thanh toán: cần Admin xử lý (hoàn tiền cho khách).'
      else 'Số tiền ' || v_amount::bigint || ' đ lớn hơn số còn phải thu ' || (v_order.net_amount - v_order.paid_amount) || ' đ: cần Admin xử lý.'
    end;
    insert into public.payments (order_id, payment_code, method, amount, status, provider, provider_reference, transfer_content, note, created_by)
    values (v_order.id, '', 'QR', v_amount::bigint, 'PENDING', c_provider, v_event_id, v_content, v_note, null)
    returning * into v_payment;
  else
    v_outcome := 'CREDITED';
    insert into public.payments (order_id, payment_code, method, amount, status, provider, provider_reference, transfer_content, paid_at, created_by)
    values (v_order.id, '', 'QR', v_amount::bigint, 'CONFIRMED', c_provider, v_event_id, v_content, v_paid_at, null)
    returning * into v_payment;
  end if;

  update public.payment_events
  set outcome = v_outcome, order_id = v_order.id, payment_id = v_payment.id, note = v_note
  where id = v_event.id;

  return jsonb_build_object('status', v_outcome, 'order_id', v_order.id, 'payment_id', v_payment.id);
end;
$$;

create or replace function public.process_sepay_webhook(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.process_sepay_event(p_payload)
$$;

-- ---------------------------------------------------------------------------
-- Review queue for events that could not be credited automatically
-- ---------------------------------------------------------------------------
create or replace function public.assign_payment_event(p_event_id uuid, p_order_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.payment_events;
  v_payment public.payments;
begin
  perform private.assert_admin_payments();
  select * into v_event from public.payment_events where id = p_event_id for update;
  if not found or v_event.outcome <> 'UNMATCHED' or v_event.resolved_at is not null then
    raise exception 'Giao dịch này không còn ở trạng thái chưa khớp đơn.';
  end if;

  insert into public.payments (order_id, payment_code, method, amount, status, provider, provider_reference,
                               transfer_content, paid_at, confirmed_by, created_by, note)
  values (p_order_id, '', 'QR', (v_event.payload ->> 'transferAmount')::bigint, 'CONFIRMED', v_event.provider,
          v_event.provider_event_id, coalesce(v_event.payload ->> 'content', v_event.payload ->> 'description'),
          now(), (select auth.uid()), (select auth.uid()), 'Admin gán thủ công từ giao dịch chưa khớp')
  returning * into v_payment;

  update public.payment_events
  set outcome = 'CREDITED', order_id = p_order_id, payment_id = v_payment.id,
      resolved_at = now(), resolved_by = (select auth.uid())
  where id = p_event_id;
  return v_payment;
end;
$$;

create or replace function public.dismiss_payment_event(p_event_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin_payments();
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'Vui lòng ghi chú cách đã xử lý giao dịch này.';
  end if;
  update public.payment_events
  set resolved_at = now(), resolved_by = (select auth.uid()), note = btrim(p_note)
  where id = p_event_id and outcome in ('UNMATCHED', 'NEEDS_REVIEW') and resolved_at is null;
  if not found then
    raise exception 'Không tìm thấy giao dịch cần xử lý.';
  end if;
end;
$$;

revoke all on function private.assert_admin_payments(), private.close_payment(uuid, text, text, text),
  private.process_sepay_event(jsonb) from public, anon, authenticated;
grant execute on function private.assert_admin_payments() to authenticated, service_role;

revoke all on function public.record_payment(uuid, text, bigint, text, boolean, text),
  public.confirm_payment(uuid), public.fail_payment(uuid, text), public.void_payment(uuid, text),
  public.refund_payment(uuid, text), public.payment_instructions(uuid),
  public.assign_payment_event(uuid, uuid), public.dismiss_payment_event(uuid, text),
  public.process_sepay_webhook(jsonb) from public, anon;
grant execute on function public.record_payment(uuid, text, bigint, text, boolean, text),
  public.confirm_payment(uuid), public.fail_payment(uuid, text), public.void_payment(uuid, text),
  public.refund_payment(uuid, text), public.payment_instructions(uuid),
  public.assign_payment_event(uuid, uuid), public.dismiss_payment_event(uuid, text) to authenticated;
-- The webhook processor is for the trusted server only.
revoke all on function public.process_sepay_webhook(jsonb) from authenticated;
grant execute on function public.process_sepay_webhook(jsonb) to service_role;
