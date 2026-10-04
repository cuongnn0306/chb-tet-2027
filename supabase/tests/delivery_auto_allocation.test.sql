-- pgTAP: RES-005 automatic physical allocation by delivery date and allocation lead time.
-- Run with: npx supabase test db   (one transaction, rolled back)
-- The job is called with explicit business dates, so nothing depends on today's date or on pg_cron.
begin;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into public.locations (code, name, location_type, region) values
  ('RA-A', 'RA A', 'STORE', 'HN'), ('RA-C', 'RA C (will be closed)', 'STORE', 'HN');
insert into public.products (sku, name, list_price) values
  ('RA-P1', 'RA FEFO', 1000), ('RA-P2', 'RA short', 1000), ('RA-P3', 'RA safety', 1000), ('RA-P4', 'RA misc', 1000);
insert into public.product_batches (batch_code, product_id, manufactured_date, expiry_date, status)
select v.code, p.id, current_date - 5, current_date + v.exp, 'ACTIVE'
from (values ('RA1-X', 'RA-P1', 10), ('RA1-Y', 'RA-P1', 30), ('RA2-X', 'RA-P2', 20),
             ('RA3-X', 'RA-P3', 20), ('RA4-X', 'RA-P4', 20)) as v(code, sku, exp)
join public.products p on p.sku = v.sku;

create temp table fx as
select
  (select id from public.locations where code = 'RA-A') as a,
  (select id from public.locations where code = 'RA-C') as c,
  (select id from public.products where sku = 'RA-P1') as p1,
  (select id from public.products where sku = 'RA-P2') as p2,
  (select id from public.products where sku = 'RA-P3') as p3,
  (select id from public.products where sku = 'RA-P4') as p4,
  (select p2.id from public.profiles p2 join public.roles r on r.id = p2.role_id where r.code = 'ADMIN' and p2.is_active limit 1) as admin_id,
  (select id from public.customers limit 1) as customer;
grant select on fx to public;

create function pg_temp.batch(code text) returns uuid language sql as
  $$ select id from public.product_batches where batch_code = code $$;

select private.post_inventory_movement('ADJUSTMENT_IN', (select p1 from fx), pg_temp.batch('RA1-X'), null, (select a from fx), 6, 'fixture');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p1 from fx), pg_temp.batch('RA1-Y'), null, (select a from fx), 60, 'fixture');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p2 from fx), pg_temp.batch('RA2-X'), null, (select a from fx), 3, 'fixture');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p3 from fx), pg_temp.batch('RA3-X'), null, (select a from fx), 10, 'fixture');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p4 from fx), pg_temp.batch('RA4-X'), null, (select a from fx), 30, 'fixture');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p4 from fx), pg_temp.batch('RA4-X'), null, (select c from fx), 10, 'fixture');
insert into public.safety_stock_rules (location_id, product_id, minimum_qty) values ((select a from fx), (select p3 from fx), 4);

create function pg_temp.mk_order(p_qty int, p_product uuid, p_state text default 'CONFIRMED') returns uuid language plpgsql as $$
declare v_order uuid;
begin
  insert into public.orders (order_code, customer_id, owner_user_id, created_by, creation_location_id,
    sales_channel_id, lead_source_id, gross_amount, net_amount)
  select '', (select customer from fx), pr.id, pr.id, (select a from fx),
    (select id from public.sales_channels limit 1), (select id from public.lead_sources limit 1),
    p_qty * 1000, p_qty * 1000
  from public.profiles pr join public.roles r on r.id = pr.role_id where r.code = 'SALE_B2B' and pr.is_active limit 1
  returning id into v_order;
  insert into public.order_items (order_id, product_id, quantity, list_price, gross_line_amount)
  values (v_order, p_product, p_qty, 1000, p_qty * 1000);
  update public.orders set status = 'WAITING_CONFIRMATION' where id = v_order;
  update public.orders set status = 'WAITING_DEPOSIT' where id = v_order;
  if p_state = 'CONFIRMED' then
    update public.orders set status = 'CONFIRMED', confirmed_at = now() where id = v_order;
  end if;
  return v_order;
end $$;

create function pg_temp.mk_delivery(p_order uuid, p_qty int, p_date date, p_loc uuid default null, p_time time default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.deliveries (delivery_code, order_id, scheduled_date, scheduled_time, recipient_name,
    recipient_phone, delivery_address, source_location_id, created_by)
  values ('', p_order, p_date, p_time, 'Khách thử', '0900000000', '12 Phố Huế',
    coalesce(p_loc, (select a from fx)), (select admin_id from fx))
  returning id into v_id;
  insert into public.delivery_items (delivery_id, order_item_id, product_id, quantity)
  select v_id, oi.id, oi.product_id, p_qty from public.order_items oi where oi.order_id = p_order;
  return v_id;
end $$;

create function pg_temp.held(p_order uuid) returns int language sql as
  $$ select coalesce(sum(r.quantity), 0)::int from public.inventory_reservations r
     where r.order_id = p_order and r.status = 'ACTIVE' and r.reservation_type = 'PHYSICAL_ALLOCATION' $$;

create function pg_temp.batch_reserved(code text) returns int language sql as
  $$ select coalesce((select sum(reserved_qty) from public.inventory_balances
       where location_id = (select a from fx) and batch_id = pg_temp.batch(code)), 0)::int $$;

create function pg_temp.out_of(p_job jsonb, p_delivery uuid) returns text language sql as
  $$ select e ->> 'outcome' from jsonb_array_elements(p_job -> 'deliveries') e where (e ->> 'delivery_id')::uuid = p_delivery $$;

create function pg_temp.evidence(p_delivery uuid, p_action text) returns int language sql as
  $$ select count(*)::int from public.audit_logs where entity_type = 'deliveries' and entity_id = p_delivery and action = p_action $$;

-- ---------------------------------------------------------------------------
-- 1. The lead time decides WHEN: scheduled_date - allocation_lead_days <= business day
-- ---------------------------------------------------------------------------
update public.app_settings set value = '3'::jsonb where key = 'allocation_lead_days';

create temp table o1 as select pg_temp.mk_order(5, (select p1 from fx)) as id;
grant select on o1 to public;
create temp table d1 as select pg_temp.mk_delivery((select id from o1), 5, date '2030-06-10') as id;
grant select on d1 to public;

create temp table j1 as select private.allocate_due_deliveries(date '2030-06-06') as r;
grant select on j1 to public;
select is(pg_temp.out_of((select r from j1), (select id from d1)), null,
  'lead 3: a delivery 4 days away is not due yet (not even listed)');
select is(pg_temp.held((select id from o1)), 0, 'a confirmed order is only demand until the lead time: nothing is physically reserved');
select is((select r ->> 'lead_days' from j1), '3', 'the configured lead time is used, not a hard-coded one');

create temp table j2 as select private.allocate_due_deliveries(date '2030-06-07') as r;
grant select on j2 to public;
select is(pg_temp.out_of((select r from j2), (select id from d1)), 'allocated', 'lead 3: exactly 3 days before the delivery it is allocated');
select is(pg_temp.held((select id from o1)), 5, 'the whole delivery quantity is physically reserved');
select is(pg_temp.batch_reserved('RA1-X'), 5, 'FEFO: the earliest-expiry batch is used first');
select is(pg_temp.batch_reserved('RA1-Y'), 0, 'FEFO: the later batch is untouched');
-- Full coverage moves CONFIRMED -> RESERVED (engine), then the existing orders_zz_fulfilment_sync trigger advances
-- an order that already has an open delivery RESERVED -> PREPARING (TECH_DESIGN §6). Both are existing rules.
select is((select status from public.orders where id = (select id from o1)), 'PREPARING', 'a fully covered CONFIRMED order with an open delivery ends in PREPARING (RESERVED, then the existing fulfilment sync)');
select is(
  (select count(*)::int from public.audit_logs where entity_id = (select id from d1) and action = 'allocate_stock'
     and actor_user_id is null and reason like 'Tự động theo thời hạn phân bổ 3 ngày%'),
  1, 'the allocation is audited as a system action naming the lead time');

create temp table j3 as select private.allocate_due_deliveries(date '2030-06-07') as r;
grant select on j3 to public;
select is(pg_temp.out_of((select r from j3), (select id from d1)), 'already_covered', 'running again is a no-op (idempotent)');
select is(pg_temp.held((select id from o1)), 5, 'no double reservation on a second run');
select is(pg_temp.evidence((select id from d1), 'allocate_stock'), 1, 'no second audit row for a no-op');

-- lead 0: due exactly on the delivery day
update public.app_settings set value = '0'::jsonb where key = 'allocation_lead_days';
create temp table o2 as select pg_temp.mk_order(2, (select p1 from fx)) as id;
grant select on o2 to public;
create temp table d2 as select pg_temp.mk_delivery((select id from o2), 2, date '2030-06-20') as id;
grant select on d2 to public;
create temp table j4 as select private.allocate_due_deliveries(date '2030-06-19') as r;
grant select on j4 to public;
select is(pg_temp.out_of((select r from j4), (select id from d2)), null, 'lead 0: the day before is too early');
create temp table j5 as select private.allocate_due_deliveries(date '2030-06-20') as r;
grant select on j5 to public;
select is(pg_temp.out_of((select r from j5), (select id from d2)), 'allocated', 'lead 0: on the delivery day it is allocated');

-- an open delivery whose date has passed is still due
create temp table o3 as select pg_temp.mk_order(3, (select p1 from fx)) as id;
grant select on o3 to public;
create temp table d3 as select pg_temp.mk_delivery((select id from o3), 3, date '2030-06-01') as id;
grant select on d3 to public;
create temp table j6 as select private.allocate_due_deliveries(date '2030-06-30') as r;
grant select on j6 to public;
select is(pg_temp.out_of((select r from j6), (select id from d3)), 'allocated', 'a past-due open delivery is allocated');

-- ---------------------------------------------------------------------------
-- 2. Confirmed demand vs physical allocation: a future sibling is neither reserved nor starved
-- ---------------------------------------------------------------------------
update public.app_settings set value = '3'::jsonb where key = 'allocation_lead_days';
create temp table o4 as select pg_temp.mk_order(10, (select p1 from fx)) as id;
grant select on o4 to public;
create temp table d4a as select pg_temp.mk_delivery((select id from o4), 4, date '2030-07-10') as id;
create temp table d4b as select pg_temp.mk_delivery((select id from o4), 6, date '2030-09-10') as id;
grant select on d4a to public;
grant select on d4b to public;
create temp table j7 as select private.allocate_due_deliveries(date '2030-07-07') as r;
grant select on j7 to public;
select is(pg_temp.out_of((select r from j7), (select id from d4a)), 'allocated', 'the due delivery of an order is allocated');
select is(pg_temp.out_of((select r from j7), (select id from d4b)), null, 'its later sibling is not due and not listed');
select is(pg_temp.held((select id from o4)), 4, 'only the due delivery quantity is reserved, never the whole order');
select is((select allocated_quantity from public.order_items where order_id = (select id from o4)), 4, 'allocated_quantity follows the due delivery only');
create temp table j8 as select private.allocate_due_deliveries(date '2030-09-07') as r;
grant select on j8 to public;
select is(pg_temp.out_of((select r from j8), (select id from d4b)), 'allocated', 'the sibling is allocated when its own lead time arrives');
select is(pg_temp.held((select id from o4)), 10, 'the order is then fully held, without double reservation');

-- ---------------------------------------------------------------------------
-- 3. Ineligible deliveries are skipped, never reserved
-- ---------------------------------------------------------------------------
create temp table o5 as select pg_temp.mk_order(3, (select p4 from fx)) as id;
grant select on o5 to public;
create temp table d5 as select pg_temp.mk_delivery((select id from o5), 3, date '2030-07-10') as id;
grant select on d5 to public;
-- goods that already left the warehouse once (first dispatch, failed, rescheduled back to READY) stay in logistics
update public.deliveries set status = 'READY' where id = (select id from d5);
update public.deliveries set status = 'OUT_FOR_DELIVERY' where id = (select id from d5);
update public.deliveries set status = 'FAILED', failed_reason = 'khách vắng nhà' where id = (select id from d5);
update public.deliveries set status = 'READY' where id = (select id from d5);

create temp table o6 as select pg_temp.mk_order(2, (select p4 from fx), 'WAITING_DEPOSIT') as id;
grant select on o6 to public;
create temp table d6 as select pg_temp.mk_delivery((select id from o6), 2, date '2030-07-10') as id;
grant select on d6 to public;

create temp table o7 as select pg_temp.mk_order(2, (select p4 from fx)) as id;
grant select on o7 to public;
create temp table d7 as select pg_temp.mk_delivery((select id from o7), 2, date '2030-07-10') as id;
grant select on d7 to public;
update public.deliveries set status = 'CANCELLED', cancelled_reason = 'khách đổi ý' where id = (select id from d7);

create temp table j9 as select private.allocate_due_deliveries(date '2030-07-07') as r;
grant select on j9 to public;
select is(pg_temp.out_of((select r from j9), (select id from d5)), null, 'goods already in logistics (dispatched once) are never auto-allocated');
select is(pg_temp.held((select id from o5)), 0, 'nothing is reserved for a delivery in logistics');
select is(pg_temp.out_of((select r from j9), (select id from d6)), null, 'an order that is not confirmed yet is skipped');
select is(pg_temp.out_of((select r from j9), (select id from d7)), null, 'a cancelled delivery is skipped');
select is(pg_temp.held((select id from o7)), 0, 'nothing is reserved for a cancelled delivery');

-- ---------------------------------------------------------------------------
-- 4. Shortage: nothing reserved, actionable evidence once per distinct shortage
-- ---------------------------------------------------------------------------
create temp table o8 as select pg_temp.mk_order(5, (select p2 from fx)) as id;
grant select on o8 to public;
create temp table d8 as select pg_temp.mk_delivery((select id from o8), 5, date '2030-07-10') as id;
grant select on d8 to public;
create temp table j10 as select private.allocate_due_deliveries(date '2030-07-07') as r;
grant select on j10 to public;
select is(pg_temp.out_of((select r from j10), (select id from d8)), 'shortage', '5 needed but only 3 in stock: reported as a shortage');
select is(pg_temp.held((select id from o8)), 0, 'all or nothing: the 3 units that exist are not reserved');
select is(pg_temp.batch_reserved('RA2-X'), 0, 'stock is untouched by a shortage');
select is(pg_temp.evidence((select id from d8), 'auto_allocate_shortage'), 1, 'actionable evidence is stored in the audit log');
select is(
  (select (after_data ->> 'shortage_total')::int from public.audit_logs
    where entity_id = (select id from d8) and action = 'auto_allocate_shortage' order by created_at desc, id desc limit 1),
  2, 'the evidence carries the missing quantity');
select is(
  (select jsonb_typeof(after_data -> 'stock_check') from public.audit_logs
    where entity_id = (select id from d8) and action = 'auto_allocate_shortage' order by created_at desc, id desc limit 1),
  'array', 'the evidence carries the transfer suggestions of the existing stock check');
select is((select actor_user_id is null from public.audit_logs
    where entity_id = (select id from d8) and action = 'auto_allocate_shortage' limit 1), true, 'the evidence is a system action');

create temp table j11 as select private.allocate_due_deliveries(date '2030-07-07') as r;
grant select on j11 to public;
select is(pg_temp.evidence((select id from d8), 'auto_allocate_shortage'), 1, 'an unchanged shortage is not logged again');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p2 from fx), pg_temp.batch('RA2-X'), null, (select a from fx), 1, 'fixture');
create temp table j12 as select private.allocate_due_deliveries(date '2030-07-07') as r;
grant select on j12 to public;
select is(pg_temp.evidence((select id from d8), 'auto_allocate_shortage'), 2, 'a changed shortage (now 1 missing) is logged again');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p2 from fx), pg_temp.batch('RA2-X'), null, (select a from fx), 10, 'fixture');
create temp table j13 as select private.allocate_due_deliveries(date '2030-07-08') as r;
grant select on j13 to public;
select is(pg_temp.out_of((select r from j13), (select id from d8)), 'allocated', 'once stock arrives the delivery is allocated');
select is(pg_temp.held((select id from o8)), 5, 'exactly the delivery quantity is then reserved');

-- ---------------------------------------------------------------------------
-- 5. Safety stock is respected (the override stays manual and Admin only)
-- ---------------------------------------------------------------------------
create temp table o9 as select pg_temp.mk_order(8, (select p3 from fx)) as id;
grant select on o9 to public;
create temp table d9 as select pg_temp.mk_delivery((select id from o9), 8, date '2030-07-10', null, time '08:00') as id;
grant select on d9 to public;
create temp table o10 as select pg_temp.mk_order(6, (select p3 from fx)) as id;
grant select on o10 to public;
create temp table d10 as select pg_temp.mk_delivery((select id from o10), 6, date '2030-07-10', null, time '09:00') as id;
grant select on d10 to public;
create temp table j14 as select private.allocate_due_deliveries(date '2030-07-07') as r;
grant select on j14 to public;
select is(pg_temp.out_of((select r from j14), (select id from d9)), 'shortage', '10 in stock with safety 4: 8 cannot be allocated (only 6 sellable)');
select is(pg_temp.held((select id from o9)), 0, 'the job never dips into safety stock');
select is(pg_temp.out_of((select r from j14), (select id from d10)), 'allocated', 'a shortage of one delivery does not block the next one that fits');
select is(pg_temp.held((select id from o10)), 6, 'the later delivery takes exactly what is sellable');

-- ---------------------------------------------------------------------------
-- 6. A pooled order-wide hold (manual allocate_order) is not doubled
-- ---------------------------------------------------------------------------
create temp table o11 as select pg_temp.mk_order(6, (select p4 from fx)) as id;
grant select on o11 to public;
select private.reserve_order_stock((select id from o11), 'PHYSICAL_ALLOCATION');
create temp table d11 as select pg_temp.mk_delivery((select id from o11), 6, date '2030-07-10') as id;
grant select on d11 to public;
create temp table j15 as select private.allocate_due_deliveries(date '2030-07-07') as r;
grant select on j15 to public;
select is(pg_temp.out_of((select r from j15), (select id from d11)), 'already_covered', 'a delivery covered by an order-wide hold needs nothing more');
select is(pg_temp.held((select id from o11)), 6, 'the order-wide hold is not doubled');

-- ---------------------------------------------------------------------------
-- 7. One failing delivery does not stop the run and leaves evidence once
-- ---------------------------------------------------------------------------
create temp table o12 as select pg_temp.mk_order(2, (select p4 from fx)) as id;
grant select on o12 to public;
create temp table d12 as select pg_temp.mk_delivery((select id from o12), 2, date '2030-07-09', (select c from fx)) as id;
grant select on d12 to public;
create temp table o13 as select pg_temp.mk_order(2, (select p4 from fx)) as id;
grant select on o13 to public;
create temp table d13 as select pg_temp.mk_delivery((select id from o13), 2, date '2030-07-10') as id;
grant select on d13 to public;
update public.locations set is_active = false where id = (select c from fx);
create temp table j16 as select private.allocate_due_deliveries(date '2030-07-07') as r;
grant select on j16 to public;
select is(pg_temp.out_of((select r from j16), (select id from d12)), 'failed', 'a delivery from a closed location fails on its own');
select is(pg_temp.out_of((select r from j16), (select id from d13)), 'allocated', 'the next delivery is still allocated in the same run');
select is(pg_temp.held((select id from o12)), 0, 'the failed delivery left nothing reserved');
select is(pg_temp.evidence((select id from d12), 'auto_allocate_failed'), 1, 'the failure is stored as evidence');
create temp table j17 as select private.allocate_due_deliveries(date '2030-07-07') as r;
grant select on j17 to public;
select is(pg_temp.evidence((select id from d12), 'auto_allocate_failed'), 1, 'the same failure is not logged again');

-- ---------------------------------------------------------------------------
-- 8. Configuration and permissions
-- ---------------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'private.allocate_due_deliveries(date)', 'execute'), false,
  'the job itself is not callable by signed-in users');
select is(has_function_privilege('anon', 'public.run_due_delivery_allocation()', 'execute'), false, 'anon cannot run the Admin wrapper');
select is(has_function_privilege('authenticated', 'public.run_due_delivery_allocation()', 'execute'), true, 'the Admin wrapper is exposed (it checks Admin itself)');

delete from public.app_settings where key = 'allocation_lead_days';
select throws_ok(
  $$select private.allocate_due_deliveries(date '2030-07-07')$$,
  'P0001', null, 'without the allocation_lead_days setting the job fails with a clear message instead of a hidden default');

select * from finish();
rollback;
