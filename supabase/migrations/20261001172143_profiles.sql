-- AUTH-002: profiles linked 1:1 to auth.users (TECH_DESIGN §3.1).
-- Users are never hard-deleted (on delete restrict): deactivate with is_active instead.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null check (btrim(full_name) <> ''),
  phone text,
  role_id uuid not null references public.roles (id),
  default_location_id uuid references public.locations (id),
  default_sales_channel_id uuid references public.sales_channels (id),
  default_lead_source_id uuid references public.lead_sources (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_id_idx on public.profiles (role_id);
create index profiles_default_location_id_idx on public.profiles (default_location_id);
create index profiles_is_active_idx on public.profiles (is_active);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

-- Creates the profile when an Admin creates an auth user.
-- role_code is read from raw_app_meta_data, which only server/admin APIs can set
-- (raw_user_meta_data is user-editable and must never decide a role).
-- Missing/unknown role_code or blank full_name => no profile => the user has no access (fail closed).
-- GoTrue's admin API writes app_metadata right after the insert, so this also runs on update;
-- it only ever creates a missing profile and never changes an existing one (role changes are Admin edits of profiles).
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id uuid;
  v_full_name text;
begin
  select id into v_role_id
  from public.roles
  where code = new.raw_app_meta_data ->> 'role_code';

  v_full_name := btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  if v_role_id is null or v_full_name = '' then
    return new;
  end if;

  insert into public.profiles (id, full_name, phone, role_id)
  values (new.id, v_full_name, nullif(new.phone, ''), v_role_id)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert or update of raw_app_meta_data on auth.users
  for each row execute function public.handle_new_auth_user();
