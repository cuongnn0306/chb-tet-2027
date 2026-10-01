-- MD-005: commission rules (TECH_DESIGN §3.22).
-- Resolution priority (implemented later in COM-001): User+Product, User, Role+Product, Role,
-- then the product default (products.default_commission_rate).
-- A rule therefore targets exactly one of user_id / role_id; product_id narrows it to one SKU.
-- Commission data is Admin-only (TECH_DESIGN §2.2: "Xem toàn bộ hoa hồng" = Admin).
-- Rules are never hard-deleted: close them with effective_to / is_active.

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id),
  role_id uuid references public.roles (id),
  product_id uuid references public.products (id),
  rate_percent numeric(5, 2) not null check (rate_percent >= 0 and rate_percent <= 100),
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_rules_one_target check (num_nonnulls(user_id, role_id) = 1),
  constraint commission_rules_period check (effective_to is null or effective_to >= effective_from)
);

create index commission_rules_user_id_idx on public.commission_rules (user_id);
create index commission_rules_role_id_idx on public.commission_rules (role_id);
create index commission_rules_product_id_idx on public.commission_rules (product_id);

create trigger commission_rules_set_updated_at
  before update on public.commission_rules
  for each row execute function public.set_updated_at();

alter table public.commission_rules enable row level security;
revoke delete, truncate on table public.commission_rules from authenticated;

create policy commission_rules_select_admin on public.commission_rules
  for select to authenticated using ((select private.is_admin()));
create policy commission_rules_insert_admin on public.commission_rules
  for insert to authenticated with check ((select private.is_admin()));
create policy commission_rules_update_admin on public.commission_rules
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create trigger audit_commission_rules after insert or update or delete on public.commission_rules
  for each row execute function private.audit_row_change();
