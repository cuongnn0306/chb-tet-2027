-- MD-004: products (TECH_DESIGN §3.7).
-- Money is integer VND (bigint). Products are never hard-deleted: deactivate with is_active.
-- Reads: any active user. Writes: Admin only. Changes are audited.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null check (btrim(name) <> ''),
  category text,
  weight_gram int check (weight_gram is null or weight_gram > 0),
  list_price bigint not null check (list_price >= 0),
  -- Base commission % used for the discount ceiling and as the product-level default rate.
  -- 0 means no default commission; stored as numeric(5,2), never float.
  default_commission_rate numeric(5, 2) not null default 0
    check (default_commission_rate >= 0 and default_commission_rate <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_idx on public.products (category);
create index products_is_active_idx on public.products (is_active);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;
revoke delete, truncate on table public.products from authenticated;

create policy products_select_active on public.products
  for select to authenticated using ((select private.is_active_user()));
create policy products_insert_admin on public.products
  for insert to authenticated with check ((select private.is_admin()));
create policy products_update_admin on public.products
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create trigger audit_products after insert or update or delete on public.products
  for each row execute function private.audit_row_change();
