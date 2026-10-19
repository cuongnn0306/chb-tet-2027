-- CUS-001 / CUS-003: customers + Vietnamese phone normalization (TECH_DESIGN §3.6, PRD §5).
-- Duplicates are allowed: NO unique constraint on phone or tax_code (PRD §5.3).
-- Customers are never hard-deleted: archive with is_archived.
-- Access (matrix is silent; least privilege): roles that can create orders may read and create
-- customers (duplicate detection needs to see other users' customers); only the creator or an
-- Admin may edit/archive one. Warehouse/Production have no access.

-- Who may work with customers / orders: Admin, Sale B2B, Store staff, Franchise staff
-- (the roles holding the create_order permission in TECH_DESIGN §2.2).
create or replace function private.can_create_orders()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role(array['ADMIN', 'SALE_B2B', 'STORE_STAFF', 'FRANCHISE_STAFF'])
$$;

revoke all on function private.can_create_orders() from public, anon;
grant execute on function private.can_create_orders() to authenticated, service_role;

-- Digits-only phone, Vietnamese country code folded to the domestic leading 0:
-- "+84 90 123 4567", "0084901234567", "84901234567" and "090.123.4567" all become "0901234567".
-- Keep identical to normalizePhone() in src/lib/phone.ts (parity checked by integration test).
create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when d = '' then null
    when d like '0084%' and length(d) between 13 and 14 then '0' || substr(d, 5)
    when d like '84%' and length(d) between 11 and 12 then '0' || substr(d, 3)
    else d
  end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) t
$$;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_type text not null check (customer_type in ('INDIVIDUAL', 'COMPANY')),
  name text,
  phone text,
  phone_normalized text generated always as (public.normalize_phone(phone)) stored,
  address text,
  company_name text,
  tax_code text,
  contact_name text,
  contact_title text,
  email text,
  company_address text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_archived boolean not null default false,
  constraint customers_has_name check (
    (customer_type = 'INDIVIDUAL' and btrim(coalesce(name, '')) <> '')
    or (customer_type = 'COMPANY' and btrim(coalesce(company_name, '')) <> '')
  )
);

create index customers_phone_normalized_idx on public.customers (phone_normalized);
create index customers_tax_code_idx on public.customers (tax_code);
create index customers_company_name_idx on public.customers (company_name);
create index customers_created_by_idx on public.customers (created_by);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- created_by is always the signed-in user on insert and can never be reassigned.
create or replace function private.customers_stamp_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger customers_stamp_creator
  before insert or update on public.customers
  for each row execute function private.customers_stamp_creator();

alter table public.customers enable row level security;
revoke delete, truncate on table public.customers from authenticated;

create policy customers_select_sales on public.customers
  for select to authenticated using ((select private.can_create_orders()));

create policy customers_insert_sales on public.customers
  for insert to authenticated
  with check ((select private.can_create_orders()) and created_by = (select auth.uid()));

create policy customers_update_owner_or_admin on public.customers
  for update to authenticated
  using ((select private.can_create_orders()) and (created_by = (select auth.uid()) or (select private.is_admin())))
  with check ((select private.can_create_orders()) and (created_by = (select auth.uid()) or (select private.is_admin())));

create trigger audit_customers after insert or update or delete on public.customers
  for each row execute function private.audit_row_change();
