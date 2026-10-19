-- COM-001: resolve the effective commission rate using the approved five-level priority.
-- The local seed supplies the Sale B2B and store profiles plus HQ-B. All added rules roll back.
begin;
select * from no_plan();

select is(
  private.resolve_commission_rate(
    (select id from public.profiles where full_name = 'Sale B2B Test'),
    (select id from public.products where sku = 'HQ-B'),
    date '2026-10-15'
  ),
  7::numeric,
  'role-wide rule wins over the product default'
);

insert into public.commission_rules (role_id, product_id, rate_percent, effective_from)
select profile.role_id, product.id, 9, date '2026-10-01'
from public.profiles profile cross join public.products product
where profile.full_name = 'Sale B2B Test' and product.sku = 'HQ-B';

select is(
  private.resolve_commission_rate(
    (select id from public.profiles where full_name = 'Sale B2B Test'),
    (select id from public.products where sku = 'HQ-B'),
    date '2026-10-15'
  ),
  9::numeric,
  'role plus product wins over role-wide rule'
);

insert into public.commission_rules (user_id, rate_percent, effective_from)
select id, 11, date '2026-10-01'
from public.profiles where full_name = 'Sale B2B Test';

select is(
  private.resolve_commission_rate(
    (select id from public.profiles where full_name = 'Sale B2B Test'),
    (select id from public.products where sku = 'HQ-B'),
    date '2026-10-15'
  ),
  11::numeric,
  'user-wide rule wins over role plus product'
);

insert into public.commission_rules (user_id, product_id, rate_percent, effective_from, effective_to)
select profile.id, product.id, 13, date '2026-10-01', date '2026-10-14'
from public.profiles profile cross join public.products product
where profile.full_name = 'Sale B2B Test' and product.sku = 'HQ-B';

select is(
  private.resolve_commission_rate(
    (select id from public.profiles where full_name = 'Sale B2B Test'),
    (select id from public.products where sku = 'HQ-B'),
    date '2026-10-14'
  ),
  13::numeric,
  'user plus product wins through its inclusive effective end date'
);

select is(
  private.resolve_commission_rate(
    (select id from public.profiles where full_name = 'Sale B2B Test'),
    (select id from public.products where sku = 'HQ-B'),
    date '2026-10-15'
  ),
  11::numeric,
  'expired user plus product falls back to user-wide rule'
);

insert into public.commission_rules (user_id, product_id, rate_percent, effective_from)
select profile.id, product.id, 0, date '2026-10-10'
from public.profiles profile cross join public.products product
where profile.full_name = 'Sale B2B Test' and product.sku = 'HQ-B';

select is(
  private.resolve_commission_rate(
    (select id from public.profiles where full_name = 'Sale B2B Test'),
    (select id from public.products where sku = 'HQ-B'),
    date '2026-10-15'
  ),
  0::numeric,
  'a zero-percent user plus product rule is valid and outranks positive rules'
);

update public.commission_rules set is_active = false
where user_id = (select id from public.profiles where full_name = 'Sale B2B Test')
  and product_id = (select id from public.products where sku = 'HQ-B')
  and rate_percent = 0;

select is(
  private.resolve_commission_rate(
    (select id from public.profiles where full_name = 'Sale B2B Test'),
    (select id from public.products where sku = 'HQ-B'),
    date '2026-10-15'
  ),
  11::numeric,
  'inactive user plus product rule is ignored'
);

update public.commission_rules set is_active = false
where user_id = (select id from public.profiles where full_name = 'Sale B2B Test')
  and product_id is null and rate_percent = 11;

select is(
  private.resolve_commission_rate(
    (select id from public.profiles where full_name = 'Sale B2B Test'),
    (select id from public.products where sku = 'HQ-B'),
    date '2026-10-15'
  ),
  9::numeric,
  'inactive user-wide rule falls back to role plus product'
);

update public.commission_rules set effective_from = date '2026-10-16'
where role_id = (select role_id from public.profiles where full_name = 'Sale B2B Test')
  and product_id = (select id from public.products where sku = 'HQ-B')
  and rate_percent = 9;

select is(
  private.resolve_commission_rate(
    (select id from public.profiles where full_name = 'Sale B2B Test'),
    (select id from public.products where sku = 'HQ-B'),
    date '2026-10-15'
  ),
  7::numeric,
  'future role plus product rule is not applied early'
);

select is(
  private.resolve_commission_rate(
    (select id from public.profiles where full_name = 'Sale B2B Test'),
    (select id from public.products where sku = 'HQ-B'),
    date '2026-10-16'
  ),
  9::numeric,
  'role plus product rule starts on its inclusive effective date'
);

select is(
  private.resolve_commission_rate(
    (select id from public.profiles where full_name = 'Nhân viên cửa hàng Test'),
    (select id from public.products where sku = 'HQ-B'),
    date '2026-10-15'
  ),
  10::numeric,
  'product default applies when no user or role rule matches'
);

select * from finish();
rollback;
