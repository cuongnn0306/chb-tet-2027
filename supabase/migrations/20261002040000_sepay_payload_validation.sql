-- PAY-007 (review RV-02): the SePay webhook processor must not auto-credit money it cannot prove is
-- ours. New checks before any order matching (SePay payload contract:
-- https://developer.sepay.vn/en/sepay-webhooks/tich-hop-webhook):
--   * id               integer transaction id (the dedup key); anything else is rejected (P0001, nothing to log under)
--   * transferType     must be exactly "in" or "out"; "out" is IGNORED; missing/other is NEEDS_REVIEW
--                      (it is NOT assumed to be "in")
--   * transferAmount   positive integer VND (unchanged: IGNORED when not)
--   * accountNumber +  must equal the receiving account configured server side in app_settings.sepay_config
--     gateway          ({"account_no": ..., "bank": ..., optional "gateway": ...}); `gateway` falls back to `bank`.
--                      Missing fields, a mismatch, or no configured account => NEEDS_REVIEW (fail closed).
-- NEEDS_REVIEW here creates NO payment and changes no paid amount: the event is stored with the reason
-- and shows up in the Admin review queue. IGNORED is reserved for events that are certainly not
-- incoming money, because a retry of an IGNORED event with the same id would only be a DUPLICATE.
-- Idempotency, atomicity and everything after the account check are unchanged.

-- Comparison form: case-insensitive, ignoring spaces and punctuation ("MB Bank" = "mbbank").
create or replace function private.sepay_norm(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]', '', 'g')
$$;

create or replace function private.process_sepay_event(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_provider constant text := 'SEPAY';
  v_id_text text;
  v_event_id text;
  v_event public.payment_events;
  v_existing text;
  v_amount numeric;
  v_direction text;
  v_account text;
  v_gateway text;
  v_config jsonb;
  v_cfg_account text;
  v_cfg_gateway text;
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
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Webhook không phải đối tượng JSON.' using errcode = 'P0001';
  end if;

  -- Transaction id: an integer (a number, or digits in a string), the same on every retry.
  v_id_text := case jsonb_typeof(p_payload -> 'id')
    when 'number' then p_payload ->> 'id'
    when 'string' then btrim(p_payload ->> 'id')
    else null
  end;
  if v_id_text is null or v_id_text !~ '^[0-9]{1,18}$' then
    raise exception 'Webhook thiếu mã giao dịch (id) hoặc id không phải số nguyên.' using errcode = 'P0001';
  end if;
  v_event_id := v_id_text;

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

  -- Direction: explicit "in" or "out" only. Missing or unknown is never assumed to be incoming money.
  v_direction := case when jsonb_typeof(p_payload -> 'transferType') = 'string'
                      then lower(btrim(p_payload ->> 'transferType')) end;
  if v_direction = 'out' then
    update public.payment_events set outcome = 'IGNORED', note = 'Giao dịch tiền ra, bỏ qua.' where id = v_event.id;
    return jsonb_build_object('status', 'IGNORED');
  end if;
  if v_direction is distinct from 'in' then
    update public.payment_events set outcome = 'NEEDS_REVIEW',
      note = 'Thiếu hoặc sai hướng giao dịch (transferType phải là "in" hoặc "out"): không tự cộng tiền, cần Admin kiểm tra.'
    where id = v_event.id;
    return jsonb_build_object('status', 'NEEDS_REVIEW');
  end if;

  -- Cast only after the shape is proven (OR does not guarantee evaluation order); a missing field
  -- leaves v_amount NULL and is rejected like any other bad amount.
  v_amount := null;
  if jsonb_typeof(p_payload -> 'transferAmount') = 'number'
     and (p_payload ->> 'transferAmount') ~ '^[0-9]{1,13}$' then
    v_amount := (p_payload ->> 'transferAmount')::numeric;
  end if;
  if v_amount is null or v_amount <= 0 then
    update public.payment_events set outcome = 'IGNORED', note = 'Số tiền không hợp lệ (cần số nguyên VND dương).' where id = v_event.id;
    return jsonb_build_object('status', 'IGNORED');
  end if;

  -- Receiving account: must be the account configured on the server for this campaign.
  v_account := case when jsonb_typeof(p_payload -> 'accountNumber') in ('string', 'number')
                    then private.sepay_norm(p_payload ->> 'accountNumber') end;
  v_gateway := case when jsonb_typeof(p_payload -> 'gateway') = 'string'
                    then private.sepay_norm(p_payload ->> 'gateway') end;
  if coalesce(v_account, '') = '' or coalesce(v_gateway, '') = '' then
    update public.payment_events set outcome = 'NEEDS_REVIEW',
      note = 'Thiếu accountNumber hoặc gateway trong webhook: không xác định được tài khoản nhận, không tự cộng tiền, cần Admin kiểm tra.'
    where id = v_event.id;
    return jsonb_build_object('status', 'NEEDS_REVIEW');
  end if;

  select value into v_config from public.app_settings where key = 'sepay_config';
  v_cfg_account := case when jsonb_typeof(v_config -> 'account_no') = 'string'
                        then private.sepay_norm(v_config ->> 'account_no') end;
  v_cfg_gateway := case when jsonb_typeof(v_config -> 'gateway') = 'string'
                        then private.sepay_norm(v_config ->> 'gateway')
                        when jsonb_typeof(v_config -> 'bank') = 'string'
                        then private.sepay_norm(v_config ->> 'bank') end;
  if coalesce(v_cfg_account, '') = '' or coalesce(v_cfg_gateway, '') = '' then
    update public.payment_events set outcome = 'NEEDS_REVIEW',
      note = 'Chưa cấu hình tài khoản nhận tiền (Cấu hình → sepay_config: account_no và bank): không tự cộng tiền, cần Admin kiểm tra.'
    where id = v_event.id;
    return jsonb_build_object('status', 'NEEDS_REVIEW');
  end if;
  if v_account <> v_cfg_account or v_gateway <> v_cfg_gateway then
    update public.payment_events set outcome = 'NEEDS_REVIEW',
      note = 'Tài khoản nhận hoặc ngân hàng (accountNumber/gateway) không khớp tài khoản đã cấu hình: không tự cộng tiền, cần Admin kiểm tra.'
    where id = v_event.id;
    return jsonb_build_object('status', 'NEEDS_REVIEW');
  end if;

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

revoke all on function private.sepay_norm(text), private.process_sepay_event(jsonb) from public, anon, authenticated;
