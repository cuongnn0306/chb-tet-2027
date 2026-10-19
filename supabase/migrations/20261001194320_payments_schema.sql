-- PAY-001, PAY-004, PAY-008: payments, provider event log, derived paid amount.
-- TECH_DESIGN §3.21, §10; PRD §18.
--
-- Money integrity (AGENTS §4):
--   * Money is integer VND (bigint).
--   * orders.paid_amount is DERIVED from CONFIRMED payments (never set by hand): a trigger recomputes it.
--   * Provider transactions are deduplicated twice: payment_events has a unique (provider, event id)
--     and payments has a unique (provider, provider_reference). A retried webhook can never credit twice.
--   * A payment cannot make an order's paid amount exceed its net amount.
--   * Payments are never deleted; amount, order and provider identity never change after creation.
--   * "Payment code per order" (PAY-004) is the order code (e.g. TET000123): it is what the customer
--     writes in the transfer content and what the webhook matches. payments.payment_code is the
--     receipt number of each individual payment record.

create sequence private.payment_code_seq as bigint start with 1 minvalue 1;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  payment_code text not null unique,
  method text not null check (method in ('CASH', 'BANK_TRANSFER', 'QR', 'COD')),
  amount bigint not null check (amount > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED', 'VOIDED')),
  provider text,
  provider_reference text,
  transfer_content text,
  note text,
  status_reason text,
  paid_at timestamptz,
  confirmed_by uuid references public.profiles (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_provider_pair check ((provider is null) = (provider_reference is null)),
  constraint payments_confirmed_has_time check (status not in ('CONFIRMED', 'REFUNDED') or paid_at is not null),
  constraint payments_reason_for_negative check (
    status not in ('FAILED', 'REFUNDED', 'VOIDED') or btrim(coalesce(status_reason, '')) <> ''
  )
);

-- The same provider transaction can exist only once.
create unique index payments_provider_reference_key
  on public.payments (provider, provider_reference)
  where provider is not null and provider_reference is not null;

create index payments_order_idx on public.payments (order_id, created_at);
create index payments_status_idx on public.payments (status) where status = 'PENDING';

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- Log of every provider callback, kept for traceability and as the first idempotency layer.
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  payload jsonb not null,
  outcome text not null default 'RECEIVED' check (outcome in (
    'RECEIVED', 'CREDITED', 'DUPLICATE', 'UNMATCHED', 'NEEDS_REVIEW', 'IGNORED'
  )),
  order_id uuid references public.orders (id),
  payment_id uuid references public.payments (id),
  note text,
  received_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id),
  constraint payment_events_provider_event_key unique (provider, provider_event_id)
);

create index payment_events_attention_idx on public.payment_events (received_at desc)
  where outcome in ('UNMATCHED', 'NEEDS_REVIEW') and resolved_at is null;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create or replace function private.payments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_confirmed bigint;
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa thanh toán. Hãy hủy hoặc hoàn tiền kèm lý do.';
  end if;

  if tg_op = 'INSERT' then
    new.payment_code := 'PAY' || lpad(nextval('private.payment_code_seq')::text, 6, '0');
  else
    if new.order_id is distinct from old.order_id or new.amount is distinct from old.amount
       or new.method is distinct from old.method or new.provider is distinct from old.provider
       or new.provider_reference is distinct from old.provider_reference
       or new.payment_code is distinct from old.payment_code or new.created_at is distinct from old.created_at then
      raise exception 'Không được sửa đơn, số tiền, phương thức hay mã giao dịch của khoản thanh toán.';
    end if;
    if new.status is distinct from old.status and (old.status, new.status) not in (
      ('PENDING', 'CONFIRMED'), ('PENDING', 'FAILED'), ('PENDING', 'VOIDED'), ('CONFIRMED', 'REFUNDED')
    ) then
      raise exception 'Không thể chuyển thanh toán từ % sang %.', old.status, new.status;
    end if;
    if old.status in ('FAILED', 'REFUNDED', 'VOIDED') and new.status is distinct from old.status then
      raise exception 'Khoản thanh toán đã đóng, không thể đổi trạng thái.';
    end if;
  end if;

  -- Becoming CONFIRMED is the only way money counts: check the order can take it.
  if new.status = 'CONFIRMED' and (tg_op = 'INSERT' or old.status <> 'CONFIRMED') then
    select * into v_order from public.orders where id = new.order_id for update;
    if v_order.status in ('DRAFT', 'CANCELLED', 'VOIDED', 'RETURNED', 'EXCHANGED') then
      raise exception 'Đơn ở trạng thái % không nhận thanh toán.', v_order.status using errcode = 'P0001';
    end if;
    select coalesce(sum(amount), 0) into v_confirmed from public.payments
    where order_id = new.order_id and status = 'CONFIRMED' and id is distinct from new.id;
    if v_confirmed + new.amount > v_order.net_amount then
      raise exception 'Số tiền vượt quá số còn phải thu của đơn (còn % đ).', v_order.net_amount - v_confirmed
        using errcode = 'P0001';
    end if;
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  return new;
end;
$$;

-- paid_amount follows the CONFIRMED payments exactly (refunds drop out of the sum).
create or replace function private.payments_refresh_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid := coalesce(new.order_id, old.order_id);
begin
  -- paid_amount only changes through this function (orders_guard refuses any other writer).
  perform set_config('app.payment_posting', 'on', true);
  update public.orders o
  set paid_amount = (select coalesce(sum(p.amount), 0) from public.payments p
                     where p.order_id = v_order and p.status = 'CONFIRMED')
  where o.id = v_order;
  perform set_config('app.payment_posting', 'off', true);
  return null;
end;
$$;

create or replace function private.payment_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa nhật ký giao dịch.';
  end if;
  if new.provider is distinct from old.provider or new.provider_event_id is distinct from old.provider_event_id
     or new.payload is distinct from old.payload or new.received_at is distinct from old.received_at then
    raise exception 'Nhật ký giao dịch không được sửa nội dung gốc.';
  end if;
  return new;
end;
$$;

create trigger payments_guard_before_write
  before insert or update or delete on public.payments
  for each row execute function private.payments_before_write();
create trigger payments_refresh_order_after_write
  after insert or update of status on public.payments
  for each row execute function private.payments_refresh_order();
create trigger payment_events_guard_write
  before update or delete on public.payment_events
  for each row execute function private.payment_events_guard();

revoke all on function private.payments_before_write(), private.payments_refresh_order(),
  private.payment_events_guard() from public, anon, authenticated;

-- Timeline order matters when several transitions happen in one transaction (e.g. deposit paid ->
-- order auto-confirmed): use the real clock, not the transaction start time.
alter table public.order_status_history alter column created_at set default clock_timestamp();

-- ---------------------------------------------------------------------------
-- Access: read-only for clients (writes go through RPCs / the service role).
-- Payments follow the order's visibility; the event log is Admin-only.
-- ---------------------------------------------------------------------------
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;

revoke all on table public.payments, public.payment_events from anon;
revoke insert, update, delete, truncate on table public.payments, public.payment_events from authenticated;

create policy payments_select_via_order on public.payments
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

create policy payment_events_select_admin on public.payment_events
  for select to authenticated
  using ((select private.is_admin()));

create trigger audit_payments after insert or update on public.payments
  for each row execute function private.audit_row_change();

-- PAY-009: the order screen updates live when a payment arrives (RLS still applies to realtime).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.payments;
    alter publication supabase_realtime add table public.orders;
  end if;
exception when duplicate_object then
  null;
end;
$$;
