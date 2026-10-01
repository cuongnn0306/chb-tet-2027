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
