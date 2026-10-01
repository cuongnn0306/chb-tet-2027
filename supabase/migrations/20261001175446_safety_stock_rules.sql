-- MD-006: safety stock per Location x SKU (TECH_DESIGN §3.14, PRD §13).
-- Sellable stock = available - reserved - safety stock (computed in later inventory tasks).
-- Reads: any active user (every role sees stock). Writes: Admin only. Changes are audited.
-- A rule is set to 0 rather than removed.

-- Shared helper: stamps who/when last changed a row. Attach as BEFORE INSERT OR UPDATE.
create or replace function private.set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_by() from public, anon;
grant execute on function private.set_updated_by() to authenticated, service_role;

create table public.safety_stock_rules (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id),
  product_id uuid not null references public.products (id),
  minimum_qty int not null check (minimum_qty >= 0),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  constraint safety_stock_rules_location_product_key unique (location_id, product_id)
);

create index safety_stock_rules_product_id_idx on public.safety_stock_rules (product_id);

create trigger safety_stock_rules_set_updated_by
  before insert or update on public.safety_stock_rules
  for each row execute function private.set_updated_by();

alter table public.safety_stock_rules enable row level security;
revoke delete, truncate on table public.safety_stock_rules from authenticated;

create policy safety_stock_rules_select_active on public.safety_stock_rules
  for select to authenticated using ((select private.is_active_user()));
create policy safety_stock_rules_insert_admin on public.safety_stock_rules
  for insert to authenticated with check ((select private.is_admin()));
create policy safety_stock_rules_update_admin on public.safety_stock_rules
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create trigger audit_safety_stock_rules after insert or update or delete on public.safety_stock_rules
  for each row execute function private.audit_row_change();
