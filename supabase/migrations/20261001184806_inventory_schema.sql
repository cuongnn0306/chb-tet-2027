-- INV-001..003: batches, inventory movements (ledger), inventory balances (cache).
-- TECH_DESIGN §3.8, §3.11, §3.12; PRD §10–§12.
--
-- Integrity model (AGENTS §4):
--   * inventory_movements is the SOURCE OF TRUTH. Rows are immutable and never deleted.
--   * inventory_balances is derived cache data. It can only change inside private.post_inventory_movement():
--     a guard trigger rejects every other write, for every role including the service role.
--   * Negative inventory is impossible: every quantity column is CHECK >= 0, and reserved <= available.
--   * Clients have no write privileges on these tables; changes go through RPCs added in the next migration.

-- ---------------------------------------------------------------------------
-- Batches (INV-001)
-- Status is not defined in the docs: ACTIVE batches can be sold/allocated, INACTIVE ones cannot.
-- ---------------------------------------------------------------------------
create table public.product_batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text not null check (btrim(batch_code) <> ''),
  product_id uuid not null references public.products (id),
  manufactured_date date not null,
  expiry_date date not null,
  production_run_id uuid, -- FK added with production runs (E09)
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  constraint product_batches_dates check (expiry_date >= manufactured_date),
  constraint product_batches_product_code_key unique (product_id, batch_code)
);

create index product_batches_expiry_date_idx on public.product_batches (expiry_date);
create index product_batches_product_id_idx on public.product_batches (product_id);

-- Identity and dates decide FEFO order and traceability: frozen once stock has moved.
create or replace function private.product_batches_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa lô hàng. Hãy đặt lô ở trạng thái ngừng dùng.';
  end if;
  if (new.product_id is distinct from old.product_id
      or new.batch_code is distinct from old.batch_code
      or new.manufactured_date is distinct from old.manufactured_date
      or new.expiry_date is distinct from old.expiry_date)
     and exists (select 1 from public.inventory_movements m where m.batch_id = old.id) then
    raise exception 'Lô đã có phát sinh tồn kho nên không được sửa sản phẩm, mã lô hoặc ngày sản xuất/hạn sử dụng.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ledger (INV-002)
-- ---------------------------------------------------------------------------
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null check (movement_type in (
    'PRODUCTION_IN', 'SALE_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN_IN', 'DAMAGE_OUT',
    'SAMPLE_OUT', 'GIFT_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
    'INSPECTION_TO_AVAILABLE', 'INSPECTION_TO_DAMAGED'
  )),
  product_id uuid not null references public.products (id),
  batch_id uuid not null references public.product_batches (id),
  from_location_id uuid references public.locations (id),
  to_location_id uuid references public.locations (id),
  quantity int not null check (quantity > 0),
  order_id uuid references public.orders (id),
  transfer_id uuid,          -- FK added with transfers (E08)
  return_id uuid,            -- FK added with returns (E10)
  production_run_id uuid,    -- FK added with production runs (E09)
  reason text,
  created_by uuid references public.profiles (id), -- NULL for system-driven movements
  created_at timestamptz not null default now(),
  -- Which locations a movement type needs (quantity is always positive; the type gives the direction).
  constraint inventory_movements_locations check (case movement_type
    when 'PRODUCTION_IN' then to_location_id is not null and from_location_id is null
    when 'SALE_OUT' then from_location_id is not null and to_location_id is null
    when 'TRANSFER_OUT' then from_location_id is not null and to_location_id is not null
                              and from_location_id <> to_location_id
    when 'TRANSFER_IN' then to_location_id is not null
    when 'RETURN_IN' then to_location_id is not null and from_location_id is null
    when 'DAMAGE_OUT' then from_location_id is not null and to_location_id is null
    when 'SAMPLE_OUT' then from_location_id is not null and to_location_id is null
    when 'GIFT_OUT' then from_location_id is not null and to_location_id is null
    when 'ADJUSTMENT_IN' then to_location_id is not null and from_location_id is null
    when 'ADJUSTMENT_OUT' then from_location_id is not null and to_location_id is null
    when 'INSPECTION_TO_AVAILABLE' then to_location_id is not null and from_location_id is null
    when 'INSPECTION_TO_DAMAGED' then to_location_id is not null and from_location_id is null
  end),
  -- Manual and loss-type movements must say why (Admin adjustments: reason + audit).
  constraint inventory_movements_reason_required check (
    movement_type not in ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGE_OUT', 'SAMPLE_OUT', 'GIFT_OUT')
    or btrim(coalesce(reason, '')) <> ''
  )
);

create index inventory_movements_batch_idx on public.inventory_movements (batch_id, created_at);
create index inventory_movements_product_idx on public.inventory_movements (product_id, created_at);
create index inventory_movements_from_idx on public.inventory_movements (from_location_id);
create index inventory_movements_to_idx on public.inventory_movements (to_location_id);
create index inventory_movements_order_idx on public.inventory_movements (order_id);
create index inventory_movements_created_at_idx on public.inventory_movements (created_at desc);

create or replace function private.inventory_movements_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Sổ kho là bất biến: không được sửa hoặc xóa movement. Hãy tạo movement điều chỉnh.';
end;
$$;

-- A movement may only be created together with its balance update, i.e. inside
-- private.post_inventory_movement(); otherwise the ledger and the cache would disagree.
create or replace function private.inventory_movements_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.inventory_posting', true), '') <> 'on' then
    raise exception 'Không được ghi trực tiếp vào sổ kho. Hãy dùng chức năng nhập/xuất/điều chỉnh kho.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Balances (INV-003): derived cache, Location x SKU x Batch
-- ---------------------------------------------------------------------------
create table public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id),
  product_id uuid not null references public.products (id),
  batch_id uuid not null references public.product_batches (id),
  available_qty int not null default 0 check (available_qty >= 0),
  reserved_qty int not null default 0 check (reserved_qty >= 0),
  in_transfer_qty int not null default 0 check (in_transfer_qty >= 0),
  pending_inspection_qty int not null default 0 check (pending_inspection_qty >= 0),
  damaged_qty int not null default 0 check (damaged_qty >= 0),
  sample_qty int not null default 0 check (sample_qty >= 0),
  gift_qty int not null default 0 check (gift_qty >= 0),
  updated_at timestamptz not null default now(),
  constraint inventory_balances_key unique (location_id, product_id, batch_id),
  -- Reserved stock is a part of available stock: it can never exceed it.
  constraint inventory_balances_reserved_within_available check (reserved_qty <= available_qty)
);

create index inventory_balances_product_idx on public.inventory_balances (product_id);
create index inventory_balances_batch_idx on public.inventory_balances (batch_id);

-- The only door to the cache: private.post_inventory_movement() turns this flag on for its own
-- transaction. Anything else (client, service role, a manual UPDATE in Studio) is refused.
create or replace function private.inventory_balances_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa dòng tồn kho.';
  end if;
  if coalesce(current_setting('app.inventory_posting', true), '') <> 'on' then
    raise exception 'Không được sửa tồn kho trực tiếp. Mọi thay đổi tồn phải tạo inventory movement.';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger product_batches_guard_update
  before update on public.product_batches
  for each row execute function private.product_batches_guard();
create trigger product_batches_guard_delete
  before delete on public.product_batches
  for each row execute function private.product_batches_guard();

create trigger inventory_movements_no_change
  before update or delete on public.inventory_movements
  for each row execute function private.inventory_movements_immutable();
create trigger inventory_movements_guard_write
  before insert on public.inventory_movements
  for each row execute function private.inventory_movements_guard_insert();
create trigger inventory_movements_no_truncate
  before truncate on public.inventory_movements
  for each statement execute function private.inventory_movements_immutable();

create trigger inventory_balances_guard_write
  before insert or update or delete on public.inventory_balances
  for each row execute function private.inventory_balances_guard();

revoke all on function private.product_batches_guard(), private.inventory_movements_immutable(),
  private.inventory_movements_guard_insert(), private.inventory_balances_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access
--   Batch detail and balances: Admin, Warehouse, Production (PRD: "Admin/Kho/Xưởng xem chi tiết Batch").
--   Sales roles read stock through the inventory_summary() function, never the batch tables.
--   Ledger history: Admin and Warehouse.
--   Nobody writes these tables directly.
-- ---------------------------------------------------------------------------
alter table public.product_batches enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_balances enable row level security;

revoke all on table public.product_batches, public.inventory_movements, public.inventory_balances from anon;
revoke insert, update, delete, truncate on table public.inventory_movements, public.inventory_balances from authenticated;
revoke delete, truncate on table public.product_batches from authenticated;

create policy product_batches_select_stock_roles on public.product_batches
  for select to authenticated
  using ((select private.has_role(array['ADMIN', 'WAREHOUSE', 'PRODUCTION'])));
create policy product_batches_insert_admin_warehouse on public.product_batches
  for insert to authenticated
  with check ((select private.has_role(array['ADMIN', 'WAREHOUSE'])));
create policy product_batches_update_admin on public.product_batches
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy inventory_balances_select_stock_roles on public.inventory_balances
  for select to authenticated
  using ((select private.has_role(array['ADMIN', 'WAREHOUSE', 'PRODUCTION'])));

create policy inventory_movements_select_admin_warehouse on public.inventory_movements
  for select to authenticated
  using ((select private.has_role(array['ADMIN', 'WAREHOUSE'])));

create trigger audit_product_batches after insert or update or delete on public.product_batches
  for each row execute function private.audit_row_change();
