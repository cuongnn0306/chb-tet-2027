-- ORD-002: server-side order code generator (e.g. TET000001). Never depends on the client.
-- The prefix comes from the Admin-configured setting `order_prefix`. If it is not configured,
-- creating an order fails with a clear message instead of inventing a default.
-- Codes come from a sequence: unique and increasing, but gaps are possible (abandoned drafts, rollbacks).

create sequence private.order_code_seq as bigint start with 1 minvalue 1;

create or replace function private.next_order_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
begin
  select value #>> '{}' into v_prefix from public.app_settings where key = 'order_prefix';
  if v_prefix is null or v_prefix = '' then
    raise exception 'Chưa cấu hình tiền tố mã đơn. Admin vui lòng thiết lập trong Cấu hình hệ thống.'
      using errcode = 'P0001';
  end if;
  return v_prefix || lpad(nextval('private.order_code_seq')::text, 6, '0');
end;
$$;

create or replace function private.orders_assign_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Always generated here: a value supplied by a caller is ignored.
  new.order_code := private.next_order_code();
  return new;
end;
$$;

create trigger orders_assign_code
  before insert on public.orders
  for each row execute function private.orders_assign_code();

revoke all on function private.next_order_code(), private.orders_assign_code() from public, anon, authenticated;
