-- MD-007: application settings (TECH_DESIGN §3.26, PRD §29).
-- Admin-only (matrix: "Settings" = Admin). Features that need a value for non-admin users must
-- read it through a trusted RPC/view built for that feature, not by opening this table.
-- Only known keys are accepted, with typed validation, so a typo or bad value (e.g. a reservation
-- TTL of 0) cannot silently break reservations. New keys are added by migration.
-- Secrets (SePay HMAC, tokens, passwords) must NEVER be stored here: they live in server secrets.

create table public.app_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null,
  description text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create or replace function private.is_json_int(p_value jsonb, p_min bigint, p_max bigint)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'number'
    and p_value::text ~ '^[0-9]{1,15}$'
    and (p_value::text)::bigint between p_min and p_max
$$;

create or replace function private.validate_app_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  v_ok := case new.key
    when 'reservation_ttl_hours'   then private.is_json_int(new.value, 1, 8760)
    when 'allocation_lead_days'    then private.is_json_int(new.value, 0, 365)
    when 'default_deposit_type'    then new.value in ('"PERCENT"'::jsonb, '"FIXED_AMOUNT"'::jsonb)
    when 'default_deposit_value'   then private.is_json_int(new.value, 0, 100000000000)
    when 'batch_expiry_alert_days' then private.is_json_int(new.value, 0, 365)
    when 'forecast_window_days'    then private.is_json_int(new.value, 1, 365)
    when 'order_prefix'            then jsonb_typeof(new.value) = 'string'
                                        and (new.value #>> '{}') ~ '^[A-Z]{1,10}$'
    when 'sepay_config'            then jsonb_typeof(new.value) = 'object'
                                        and new.value::text !~* '"[^"]*(secret|hmac|token|password|api[_-]?key|private)[^"]*"\s*:'
    else null
  end;

  if v_ok is null then
    raise exception 'Khóa cấu hình không hợp lệ: %', new.key using errcode = '23514';
  end if;
  if not v_ok then
    raise exception 'Giá trị không hợp lệ cho cấu hình %', new.key using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger app_settings_validate
  before insert or update on public.app_settings
  for each row execute function private.validate_app_setting();

create trigger app_settings_set_updated_by
  before insert or update on public.app_settings
  for each row execute function private.set_updated_by();

alter table public.app_settings enable row level security;
revoke delete, truncate on table public.app_settings from authenticated;

create policy app_settings_select_admin on public.app_settings
  for select to authenticated using ((select private.is_admin()));
create policy app_settings_insert_admin on public.app_settings
  for insert to authenticated with check ((select private.is_admin()));
create policy app_settings_update_admin on public.app_settings
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create trigger audit_app_settings after insert or update or delete on public.app_settings
  for each row execute function private.audit_row_change();
