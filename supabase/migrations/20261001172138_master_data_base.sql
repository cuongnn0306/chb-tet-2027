-- AUTH-002 (prerequisite tables): locations, sales channels, lead sources (TECH_DESIGN §3.3–3.5).
-- Master data is never hard-deleted: use is_active. No DELETE policy will be created.
-- RLS enabled now; policies arrive with AUTH-004 (no policy = deny all).

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location_type text not null
    check (location_type in ('CENTRAL_KITCHEN', 'OFFICE', 'STORE', 'FRANCHISE')),
  region text,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.sales_channels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  sort_order int not null default 0
);

create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  sort_order int not null default 0
);

alter table public.locations enable row level security;
alter table public.sales_channels enable row level security;
alter table public.lead_sources enable row level security;
