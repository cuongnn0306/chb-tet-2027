-- Seed (INF-006). LOCAL / STAGING TEST DATA ONLY — never run against production.
-- Contains fake data and test accounts. Real master data is configured by an Admin in the app.
-- Test accounts share one throw-away password defined below; they exist only in local/staging.

-- Locations (5 test locations across 2 regions)
insert into public.locations (code, name, location_type, region, address) values
  ('HN-BEP', '[Test] Bếp tổng Hà Nội', 'CENTRAL_KITCHEN', 'HN', 'Địa chỉ giả 1'),
  ('HN-VP',  '[Test] Văn phòng Hà Nội',  'OFFICE',          'HN', 'Địa chỉ giả 2'),
  ('HN-CH1', '[Test] Cửa hàng CHB 1',    'STORE',           'HN', 'Địa chỉ giả 3'),
  ('HN-CH2', '[Test] Cửa hàng CHB 2',    'STORE',           'HN', 'Địa chỉ giả 4'),
  ('HCM-FR1','[Test] Franchise HCM 1',   'FRANCHISE',       'HCM','Địa chỉ giả 5');

-- Sales channels (PRD §4.1)
insert into public.sales_channels (code, name, sort_order) values
  ('STORE',     'Cửa hàng trực thuộc', 1),
  ('FRANCHISE', 'Franchise',           2),
  ('ONLINE',    'Online',              3),
  ('B2B',       'B2B',                 4),
  ('CTV',       'CTV',                 5);

-- Lead sources (PRD §4.2)
insert into public.lead_sources (code, name, sort_order) values
  ('FACEBOOK',        'Facebook',              1),
  ('TIKTOK',          'TikTok',                2),
  ('ZALO',            'Zalo',                  3),
  ('HOTLINE',         'Hotline',               4),
  ('WEBSITE',         'Website',               5),
  ('CORPORATE',       'Khách doanh nghiệp',    6),
  ('STAFF_REFERRAL',  'Nhân viên giới thiệu',  7),
  ('COLLABORATOR',    'Cộng tác viên',         8),
  ('WALK_IN',         'Walk-in',               9),
  ('OTHER',           'Khác',                 10);

-- Demo SKUs (UAT needs 10-12). Names/prices are made up for testing only; commission rates are examples.
insert into public.products (sku, name, category, weight_gram, list_price, default_commission_rate) values
  ('TT-1200',  '[Test] Bánh chưng truyền thống 1.2kg', 'Bánh truyền thống', 1200, 180000, 8),
  ('TT-800',   '[Test] Bánh chưng truyền thống 800g',  'Bánh truyền thống',  800, 130000, 8),
  ('TT-500',   '[Test] Bánh chưng truyền thống 500g',  'Bánh truyền thống',  500,  90000, 8),
  ('COM-800',  '[Test] Bánh chưng cốm 800g',           'Bánh theo vị',       800, 150000, 8),
  ('COM-500',  '[Test] Bánh chưng cốm 500g',           'Bánh theo vị',       500, 100000, 8),
  ('CB-2X500', '[Test] Combo 2 bánh 500g',             'Combo',             1000, 170000, 6),
  ('HQ-A',     '[Test] Hộp quà Tết A',                 'Hộp quà',           2000, 450000, 10),
  ('HQ-B',     '[Test] Hộp quà Tết B',                 'Hộp quà',           3000, 650000, 10),
  ('HQ-C',     '[Test] Hộp quà Tết C',                 'Hộp quà',           4500, 950000, 10),
  ('DG-TUI',   '[Test] Túi quà đóng gói',              'Đóng gói khác',      300,  60000, 5),
  ('DG-NGUNG', '[Test] SKU ngừng bán',                 'Đóng gói khác',      null, 50000, 0);
update public.products set is_active = false where sku = 'DG-NGUNG';

-- Example commission rules (test data): role-wide, role+product, and a user+product override.
-- Their user_id is filled after the test accounts exist (see the end of this file).
insert into public.commission_rules (role_id, product_id, rate_percent, effective_from)
select r.id, null, 7, date '2026-10-01' from public.roles r where r.code = 'SALE_B2B';
insert into public.commission_rules (role_id, product_id, rate_percent, effective_from)
select r.id, p.id, 12, date '2026-10-01'
from public.roles r, public.products p where r.code = 'SALE_B2B' and p.sku = 'HQ-A';

-- Example safety stock (PRD §13 examples), per Location x SKU.
insert into public.safety_stock_rules (location_id, product_id, minimum_qty)
select l.id, p.id, v.qty
from (values
  ('HN-VP',   'TT-1200', 50),
  ('HN-CH1',  'TT-1200', 20),
  ('HN-CH1',  'COM-800', 10),
  ('HN-CH2',  'TT-800',  15),
  ('HCM-FR1', 'HQ-A',     5)
) as v(location_code, sku, qty)
join public.locations l on l.code = v.location_code
join public.products p on p.sku = v.sku;

-- Example app settings (test data). TTL 24h and prefix TET come from PRD §9 / plan §11.2;
-- the other values are made-up examples. In production an Admin sets them in the app.
insert into public.app_settings (key, value, description) values
  ('reservation_ttl_hours',   '24'::jsonb,            'Thời gian giữ hàng tạm (giờ)'),
  ('allocation_lead_days',    '5'::jsonb,             'Số ngày khóa tồn trước ngày giao'),
  ('default_deposit_type',    '"PERCENT"'::jsonb,     'Kiểu tiền cọc mặc định'),
  ('default_deposit_value',   '30'::jsonb,            'Giá trị tiền cọc mặc định'),
  ('batch_expiry_alert_days', '14'::jsonb,            'Cảnh báo lô sắp hết hạn (ngày)'),
  ('forecast_window_days',    '14'::jsonb,            'Cửa sổ dự báo (ngày)'),
  ('order_prefix',            '"TET"'::jsonb,         'Tiền tố mã đơn');

-- Test accounts: one per role + one inactive user.
-- The on_auth_user_created trigger creates each profile from app_metadata.role_code.
do $$
declare
  v_password constant text := 'Test@12345';  -- throw-away, local/staging only
  r record;
  v_id uuid;
begin
  for r in
    select * from (values
      ('admin@chb-test.local',     'ADMIN',           'Admin Test',            'HN-VP',  'B2B',       'CORPORATE', true),
      ('sale@chb-test.local',      'SALE_B2B',        'Sale B2B Test',         'HN-VP',  'B2B',       'CORPORATE', true),
      ('store@chb-test.local',     'STORE_STAFF',     'Nhân viên cửa hàng Test','HN-CH1', 'STORE',     'WALK_IN',   true),
      ('franchise@chb-test.local', 'FRANCHISE_STAFF', 'Nhân viên franchise Test','HCM-FR1','FRANCHISE', 'WALK_IN',   true),
      ('warehouse@chb-test.local', 'WAREHOUSE',       'Kho Test',              'HN-BEP', null,        null,        true),
      ('production@chb-test.local','PRODUCTION',      'Xưởng Test',            'HN-BEP', null,        null,        true),
      ('inactive@chb-test.local',  'STORE_STAFF',     'Nhân viên đã nghỉ Test','HN-CH2', 'STORE',     'WALK_IN',   false)
    ) as t(email, role_code, full_name, location_code, channel_code, source_code, is_active)
  loop
    v_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      r.email, crypt(v_password, gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role_code', r.role_code),
      jsonb_build_object('full_name', r.full_name),
      now(), now(), '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_id, v_id::text, 'email',
      jsonb_build_object('sub', v_id::text, 'email', r.email, 'email_verified', true),
      now(), now(), now()
    );

    update public.profiles p set
      default_location_id      = (select id from public.locations      where code = r.location_code),
      default_sales_channel_id = (select id from public.sales_channels where code = r.channel_code),
      default_lead_source_id   = (select id from public.lead_sources   where code = r.source_code),
      is_active                = r.is_active
    where p.id = v_id;
  end loop;
end;
$$;

insert into public.commission_rules (user_id, product_id, rate_percent, effective_from)
select pr.id, p.id, 5, date '2026-10-01'
from public.profiles pr, public.products p
where pr.full_name = 'Nhân viên cửa hàng Test' and p.sku = 'TT-1200';

-- Test customers (fake). Includes a duplicate-phone pair in different formats, two companies,
-- one customer created by store staff, and one archived customer.
insert into public.customers
  (customer_type, name, phone, address, company_name, tax_code, contact_name, contact_title, email, company_address, created_by, is_archived)
select v.customer_type, v.name, v.phone, v.address, v.company_name, v.tax_code, v.contact_name, v.contact_title, v.email, v.company_address,
       (select id from public.profiles where full_name = v.creator), v.is_archived
from (values
  ('INDIVIDUAL', 'Nguyễn Văn Test', '0900000001',        'Địa chỉ giả A', null, null, null, null, null, null, 'Sale B2B Test', false),
  ('INDIVIDUAL', 'Trần Thị Mẫu',    '+84 90 000 0002',   'Địa chỉ giả B', null, null, null, null, null, null, 'Sale B2B Test', false),
  ('INDIVIDUAL', 'Nguyễn V. Test (trùng SĐT)', '090.000.0001', 'Địa chỉ giả C', null, null, null, null, null, null, 'Sale B2B Test', false),
  ('COMPANY', null, '0900000003', null, 'Công ty TNHH Test ABC', '0100000001', 'Lê Văn Liên', 'Giám đốc', 'lien@abc.test', 'Địa chỉ công ty giả 1', 'Sale B2B Test', false),
  ('COMPANY', null, '0900000005', null, 'Công ty CP Mẫu XYZ',    '0100000002-001', 'Phạm Thị Hoa', 'Kế toán', 'hoa@xyz.test', 'Địa chỉ công ty giả 2', 'Sale B2B Test', false),
  ('INDIVIDUAL', 'Khách của cửa hàng', '0900000004', 'Địa chỉ giả D', null, null, null, null, null, null, 'Nhân viên cửa hàng Test', false),
  ('INDIVIDUAL', 'Khách đã lưu trữ', '0900000006', 'Địa chỉ giả E', null, null, null, null, null, null, 'Sale B2B Test', true)
) as v(customer_type, name, phone, address, company_name, tax_code, contact_name, contact_title, email, company_address, creator, is_archived);
