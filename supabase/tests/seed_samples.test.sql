-- pgTAP: INF-006 local demo seed remains usable and leaves accounting untouched.
begin;
select plan(12);

select is((select count(*)::int from public.products), 11, 'seed has 11 demo SKUs');
select is((select count(*)::int from public.locations), 5, 'seed has five test locations');
select is((select count(*)::int from public.customers), 7, 'seed has seven fake customers');
select is((select count(*)::int from public.product_batches), 9, 'seed has active and expired batches');
select is((select count(*)::int from public.inventory_movements where movement_type = 'ADJUSTMENT_IN'), 14,
  'opening stock is posted as fourteen traceable ledger movements');

select is((select count(*)::int from public.orders where notes like '[Test] Đơn nháp%'), 2,
  'the seed provides two sample orders');
select is((select count(*)::int from public.orders where notes like '[Test] Đơn nháp%' and status = 'DRAFT'), 2,
  'sample orders remain drafts, without confirmed demand');
select is((select gross_amount from public.orders where notes = '[Test] Đơn nháp B2B nhiều SKU'), 990000::bigint,
  'B2B sample totals its two price-snapshotted lines');
select is((select gross_amount from public.orders where notes = '[Test] Đơn nháp cửa hàng nhiều SKU'), 410000::bigint,
  'store sample totals its two price-snapshotted lines');
select is((select count(*)::int from public.order_items oi join public.orders o on o.id = oi.order_id
  where o.notes like '[Test] Đơn nháp%'), 4, 'both sample orders retain their two lines');
select is((select count(*)::int from public.inventory_reservations r join public.orders o on o.id = r.order_id
  where o.notes like '[Test] Đơn nháp%'), 0, 'sample drafts do not reserve stock');
select set_config('request.jwt.claim.sub',
  (select p.id::text from public.profiles p join public.roles r on r.id = p.role_id where r.code = 'ADMIN' and p.is_active limit 1), true);
select is((select count(*)::int from public.verify_inventory_balances()), 0,
  'seeded opening stock reconciles with the movement ledger');

select * from finish();
rollback;
