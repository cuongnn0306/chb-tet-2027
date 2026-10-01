-- AUTH-003: approved role codes and permission matrix (TECH_DESIGN §2).
-- Roles are system reference data (needed in every environment), not test data.
-- permissions is a UI hint ({permission: true | "rule"}); authorization is enforced by RLS/RPC.
-- Source of truth for the matrix in code: src/domain/auth/roles.ts (parity checked by integration test).

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique
    check (code in ('ADMIN', 'SALE_B2B', 'STORE_STAFF', 'FRANCHISE_STAFF', 'WAREHOUSE', 'PRODUCTION')),
  name text not null,
  description text,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- RLS on from the start. No policy yet = deny all; policies arrive with AUTH-004.
alter table public.roles enable row level security;

insert into public.roles (code, name, description, permissions) values
  ('ADMIN', 'Admin HQ', 'Toàn quyền quản trị hệ thống.',
   '{"create_order":true,"view_own_orders":true,"view_all_orders":true,"edit_price_discount":true,"void_order":true,"confirm_payment":true,"view_system_inventory":true,"adjust_inventory":true,"propose_transfer":true,"approve_transfer":true,"confirm_transfer_movement":true,"view_production_plan":true,"update_production":true,"view_own_commission":true,"view_all_commission":true,"manage_settings":true,"manage_master_data":true,"view_audit_log":true}'::jsonb),
  ('SALE_B2B', 'Sale B2B', 'Nhập đơn, khách hàng; xem đơn, doanh số, tồn và hoa hồng của mình.',
   '{"create_order":true,"view_own_orders":true,"edit_price_discount":"rule","view_system_inventory":true,"propose_transfer":true,"view_own_commission":true}'::jsonb),
  ('STORE_STAFF', 'Nhân viên cửa hàng CHB', 'Nhập đơn; xem đơn, doanh số, tồn; đề xuất điều chuyển.',
   '{"create_order":true,"view_own_orders":true,"edit_price_discount":"rule","view_system_inventory":true,"propose_transfer":true,"view_own_commission":true}'::jsonb),
  ('FRANCHISE_STAFF', 'Nhân viên cơ sở nhượng quyền', 'Tương tự nhân viên cửa hàng CHB.',
   '{"create_order":true,"view_own_orders":true,"edit_price_discount":"rule","view_system_inventory":true,"propose_transfer":true,"view_own_commission":true}'::jsonb),
  ('WAREHOUSE', 'Kho', 'Xem nhu cầu, kế hoạch sản xuất; xác nhận nhập/xuất kho và điều chuyển.',
   '{"view_system_inventory":true,"propose_transfer":true,"confirm_transfer_movement":true,"view_production_plan":true}'::jsonb),
  ('PRODUCTION', 'Xưởng sản xuất', 'Xem kế hoạch và cập nhật sản xuất.',
   '{"view_system_inventory":true,"view_production_plan":true,"update_production":true}'::jsonb);
