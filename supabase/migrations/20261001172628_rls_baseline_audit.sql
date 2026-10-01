-- AUTH-004: RLS baseline, permission helpers, audit log (TECH_DESIGN §2.2, §3.27).
-- Principles:
--   * anon has no access to application tables.
--   * Only active users (profile.is_active) can read application data; an unknown/inactive user sees nothing.
--   * Writes to master data are Admin-only. Nobody can DELETE rows (deactivate with is_active instead).
--   * audit_logs is written only by triggers and is immutable.

-- ---------------------------------------------------------------------------
-- Defence in depth: anon gets nothing, now and for future tables.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

revoke all on table public.roles, public.locations, public.sales_channels,
  public.lead_sources, public.profiles from anon;

-- Hard delete/truncate is never allowed from the client on these tables.
revoke delete, truncate on table public.roles, public.locations, public.sales_channels,
  public.lead_sources, public.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- Permission helpers (private schema: not exposed through the Data API).
-- SECURITY DEFINER so policies can read profiles/roles regardless of the caller's own RLS.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Role code of the current user, or NULL when not signed in, without a profile, or inactive.
create or replace function private.current_role_code()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.code
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_role_code() is not null
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_role_code() = 'ADMIN', false)
$$;

create or replace function private.has_role(p_codes text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_role_code() = any (p_codes), false)
$$;

revoke all on function private.current_role_code(), private.is_active_user(),
  private.is_admin(), private.has_role(text[]) from public, anon;
grant execute on function private.current_role_code(), private.is_active_user(),
  private.is_admin(), private.has_role(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- audit_logs (TECH_DESIGN §3.27): immutable, written only by triggers.
-- actor_user_id is NULL for system/service actions (e.g. seed, migrations).
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles (id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from anon, authenticated;
grant select on table public.audit_logs to authenticated;

create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using ((select private.is_admin()));

create or replace function private.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs là bất biến: không được sửa hoặc xóa';
end;
$$;

create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function private.audit_logs_immutable();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function private.audit_logs_immutable();

-- Generic row audit: attach with AFTER INSERT OR UPDATE OR DELETE ... FOR EACH ROW.
-- Optional reason: set_config('app.audit_reason', '<text>', true) inside the same transaction.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  insert into public.audit_logs (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (
    (select auth.uid()),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id')::uuid,
    lower(tg_op),
    v_old,
    v_new,
    nullif(current_setting('app.audit_reason', true), '')
  );
  return null;
end;
$$;

revoke all on function private.audit_row_change(), private.audit_logs_immutable()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- roles: any active user can read; no client writes (roles change by migration).
create policy roles_select_active on public.roles
  for select to authenticated
  using ((select private.is_active_user()));

-- Master data: active users read; Admin writes. No delete policy.
create policy locations_select_active on public.locations
  for select to authenticated using ((select private.is_active_user()));
create policy locations_insert_admin on public.locations
  for insert to authenticated with check ((select private.is_admin()));
create policy locations_update_admin on public.locations
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy sales_channels_select_active on public.sales_channels
  for select to authenticated using ((select private.is_active_user()));
create policy sales_channels_insert_admin on public.sales_channels
  for insert to authenticated with check ((select private.is_admin()));
create policy sales_channels_update_admin on public.sales_channels
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy lead_sources_select_active on public.lead_sources
  for select to authenticated using ((select private.is_active_user()));
create policy lead_sources_insert_admin on public.lead_sources
  for insert to authenticated with check ((select private.is_admin()));
create policy lead_sources_update_admin on public.lead_sources
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- profiles: a user reads their own profile (even if inactive, so the app can explain why access
-- is blocked); Admin reads and writes all. Users cannot edit their own role/status.
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_insert_admin on public.profiles
  for insert to authenticated with check ((select private.is_admin()));
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Audit master data changes
-- ---------------------------------------------------------------------------
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function private.audit_row_change();
create trigger audit_locations after insert or update or delete on public.locations
  for each row execute function private.audit_row_change();
create trigger audit_sales_channels after insert or update or delete on public.sales_channels
  for each row execute function private.audit_row_change();
create trigger audit_lead_sources after insert or update or delete on public.lead_sources
  for each row execute function private.audit_row_change();
