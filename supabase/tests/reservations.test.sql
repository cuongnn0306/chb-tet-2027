-- pgTAP: reservations, FEFO allocation, TTL expiry, shortage and source suggestions (E05).
-- Run with: npx supabase test db   (one transaction, rolled back)
begin;
select plan(67);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into public.locations (code, name, location_type, region) values
  ('RT-A', 'RT A', 'STORE', 'HN'), ('RT-B', 'RT B', 'STORE', 'HN'), ('RT-C', 'RT C', 'STORE', 'HCM');
insert into public.products (sku, name, list_price) values ('RT-SKU', 'RT product', 1000);

-- batches (inserted in non-expiry order on purpose)
insert into public.product_batches (batch_code, product_id, manufactured_date, expiry_date, status)
select v.code, p.id, current_date - 5, current_date + v.exp, v.status
from public.products p
cross join (values ('RT-X2', 30, 'ACTIVE'), ('RT-X1', 10, 'ACTIVE'), ('RT-X3', 20, 'ACTIVE'),
                   ('RT-OLD', -1, 'ACTIVE'), ('RT-OFF', 5, 'INACTIVE')) as v(code, exp, status)
where p.sku = 'RT-SKU';

create temp table fx as
select
  (select id from public.locations where code = 'RT-A') as a,
  (select id from public.locations where code = 'RT-B') as b,
  (select id from public.locations where code = 'RT-C') as c,
  (select id from public.products where sku = 'RT-SKU') as p,
  (select p2.id from public.profiles p2 join public.roles r on r.id = p2.role_id where r.code = 'ADMIN' and p2.is_active limit 1) as admin_id,
  (select id from public.customers limit 1) as customer;
grant select on fx to public;

create function pg_temp.batch(code text) returns uuid language sql as
  $$ select id from public.product_batches where batch_code = code and product_id = (select p from fx) $$;

-- stock at RT-A: X1 5 (exp +10), X2 10 (+30), X3 8 (+20), expired batch 100, inactive batch 100
select private.post_inventory_movement('ADJUSTMENT_IN', (select p from fx), pg_temp.batch('RT-X1'), null, (select a from fx), 5, 'fixture');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p from fx), pg_temp.batch('RT-X2'), null, (select a from fx), 10, 'fixture');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p from fx), pg_temp.batch('RT-X3'), null, (select a from fx), 8, 'fixture');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p from fx), pg_temp.batch('RT-OLD'), null, (select a from fx), 100, 'fixture');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p from fx), pg_temp.batch('RT-OFF'), null, (select a from fx), 100, 'fixture');

create function pg_temp.mk_order(p_qty int, p_loc uuid default null) returns uuid language plpgsql as $$
declare v_order uuid;
begin
  insert into public.orders (order_code, customer_id, owner_user_id, created_by, creation_location_id,
    sales_channel_id, lead_source_id, gross_amount, net_amount)
  select '', (select customer from fx), pr.id, pr.id, coalesce(p_loc, (select a from fx)),
    (select id from public.sales_channels limit 1), (select id from public.lead_sources limit 1),
    p_qty * 1000, p_qty * 1000
  from public.profiles pr join public.roles r on r.id = pr.role_id where r.code = 'SALE_B2B' and pr.is_active limit 1
  returning id into v_order;
  insert into public.order_items (order_id, product_id, quantity, list_price, gross_line_amount)
  values (v_order, (select p from fx), p_qty, 1000, p_qty * 1000);
  return v_order;
end $$;

create function pg_temp.reserved(code text) returns int language sql as
  $$ select coalesce((select reserved_qty from public.inventory_balances
       where location_id = (select a from fx) and product_id = (select p from fx) and batch_id = pg_temp.batch(code)), 0) $$;

create function pg_temp.act_as_admin() returns void language sql as
  $$ select set_config('request.jwt.claim.sub', (select admin_id::text from fx), true) $$;

-- ---------------------------------------------------------------------------
-- FEFO + multi-batch (RES-006, RES-008) -- no safety rule yet
-- ---------------------------------------------------------------------------
select set_config('app.t', 'x', true);
create temp table ord as select pg_temp.mk_order(12) as id;
grant select on ord to public;

select is(
  (private.reserve_order_stock((select id from ord), 'PHYSICAL_ALLOCATION') -> 'lines' -> 0 ->> 'reserved_now')::int, 12,
  'a 12-unit order is fully allocated from several batches');
select is(pg_temp.reserved('RT-X1'), 5, 'FEFO: earliest-expiry batch (+10d) is emptied first');
select is(pg_temp.reserved('RT-X3'), 7, 'FEFO: then the next expiry (+20d)');
select is(pg_temp.reserved('RT-X2'), 0, 'FEFO: the latest expiry (+30d) is untouched');
select is(pg_temp.reserved('RT-OLD'), 0, 'an expired batch is never allocated');
select is(pg_temp.reserved('RT-OFF'), 0, 'an INACTIVE batch is never allocated');
select is(
  (select count(*)::int from public.inventory_reservations where order_id = (select id from ord) and reservation_type = 'PHYSICAL_ALLOCATION' and status = 'ACTIVE'),
  2, 'two reservation rows (one per batch used)');
select is((select allocated_quantity from public.order_items where order_id = (select id from ord)), 12, 'allocated_quantity follows physical allocation');

-- ---------------------------------------------------------------------------
-- A reservation never lets stock go below zero: reserved stock cannot be taken by an exit
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select private.post_inventory_movement('SALE_OUT', (select p from fx), pg_temp.batch('RT-X1'), (select a from fx), null, 1)$$,
  'P0001', null, 'reserved stock cannot be taken by another movement');
select lives_ok(
  $$select private.post_inventory_movement('SALE_OUT', (select p from fx), pg_temp.batch('RT-X2'), (select a from fx), null, 10)$$,
  'free (unreserved) stock can still be taken');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p from fx), pg_temp.batch('RT-X2'), null, (select a from fx), 10, 'restock');

-- ---------------------------------------------------------------------------
-- Release gives the stock back
-- ---------------------------------------------------------------------------
select is(private.release_order_reservations((select id from ord), 'RELEASED', 'test'), 2, 'releasing closes both reservation rows');
select is(pg_temp.reserved('RT-X1') + pg_temp.reserved('RT-X3'), 0, 'cached reserved quantity is freed');
select is((select allocated_quantity from public.order_items where order_id = (select id from ord)), 0, 'allocated_quantity goes back to 0');
select is(
  (select count(*)::int from public.inventory_reservations where order_id = (select id from ord) and status = 'RELEASED' and released_at is not null),
  2, 'closed rows are stamped with time and reason');

-- ---------------------------------------------------------------------------
-- Safety stock (RES: "không phá safety stock ngoài rule")
-- ---------------------------------------------------------------------------
insert into public.safety_stock_rules (location_id, product_id, minimum_qty) values ((select a from fx), (select p from fx), 4);
select is(private.sellable_qty((select a from fx), (select p from fx)), 19, 'sellable = (5+10+8) - safety 4; expired/inactive stock ignored');

create temp table ord2 as select pg_temp.mk_order(25) as id;
grant select on ord2 to public;
select is(
  (private.reserve_order_stock((select id from ord2), 'PHYSICAL_ALLOCATION') -> 'lines' -> 0 ->> 'reserved_now')::int, 19,
  'allocation stops at the sellable quantity (safety stock kept)');
select is(
  (select (l ->> 'shortage')::int from jsonb_array_elements(private.reserve_order_stock((select id from ord2), 'PHYSICAL_ALLOCATION') -> 'lines') l limit 1),
  6, 'the missing 6 units are reported as shortage');
select is(
  (select sum(b.available_qty - b.reserved_qty)::int from public.inventory_balances b join public.product_batches pb on pb.id = b.batch_id
    where b.location_id = (select a from fx) and b.product_id = (select p from fx) and pb.status = 'ACTIVE' and pb.expiry_date >= current_date),
  4, 'exactly the safety stock (4) is left free');
select private.release_order_reservations((select id from ord2), 'RELEASED', 'test');

-- ... unless the Admin override is used
select is(
  (private.reserve_order_stock((select id from ord2), 'PHYSICAL_ALLOCATION', null, true) -> 'lines' -> 0 ->> 'reserved_now')::int, 23,
  'with the Admin override the safety stock may be used');
select private.release_order_reservations((select id from ord2), 'RELEASED', 'test');

-- ---------------------------------------------------------------------------
-- Temporary reservation + TTL (RES-001..003) driven by the order status
-- ---------------------------------------------------------------------------
select is((select value #>> '{}' from public.app_settings where key = 'reservation_ttl_hours'), '24', 'seed has a 24h TTL');
create temp table ord3 as select pg_temp.mk_order(6) as id;
grant select on ord3 to public;
update public.orders set status = 'WAITING_CONFIRMATION' where id = (select id from ord3);
select is((select count(*)::int from public.inventory_reservations where order_id = (select id from ord3)), 0, 'a submitted order holds no stock yet');
update public.orders set status = 'WAITING_DEPOSIT' where id = (select id from ord3);
select is(
  (select sum(quantity)::int from public.inventory_reservations where order_id = (select id from ord3) and reservation_type = 'TEMPORARY' and status = 'ACTIVE'),
  6, 'moving to WAITING_DEPOSIT takes a temporary hold');
select ok(
  (select expires_at between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute'
     from public.inventory_reservations where order_id = (select id from ord3) limit 1),
  'the hold expires after the configured TTL');
select ok(
  (select reservation_expires_at is not null from public.orders where id = (select id from ord3)),
  'the order shows when its hold expires');
select is((select allocated_quantity from public.order_items where order_id = (select id from ord3)), 0, 'a temporary hold is not a physical allocation');

select is((select count(*)::int from public.inventory_reservations where order_id = (select id from ord3) and status = 'ACTIVE'), 2, 'the hold rows are still ACTIVE before the TTL');
select is(private.expire_temporary_reservations(now()) >= 0, true, 'running the job before the TTL is harmless');
select is(pg_temp.reserved('RT-X1') + pg_temp.reserved('RT-X3'), 6, 'the hold is still in place');
-- The job releases every expired hold in the database (other tests may have left some): require at least ours.
select cmp_ok(private.expire_temporary_reservations(now() + interval '25 hours'), '>=', 2, 'after the TTL the hold expires (one row per batch used)');
select is(pg_temp.reserved('RT-X1') + pg_temp.reserved('RT-X3'), 0, 'expiry frees the stock');
select is((select distinct status from public.inventory_reservations where order_id = (select id from ord3)), 'EXPIRED', 'the rows are marked EXPIRED');
select is((select status from public.orders where id = (select id from ord3)), 'WAITING_DEPOSIT', 'the order stays in WAITING_DEPOSIT after expiry');
select ok((select reservation_expires_at is null from public.orders where id = (select id from ord3)), 'the order no longer claims a hold');

-- cancelling releases a live hold
create temp table ord4 as select pg_temp.mk_order(3) as id;
grant select on ord4 to public;
update public.orders set status = 'WAITING_CONFIRMATION' where id = (select id from ord4);
update public.orders set status = 'WAITING_DEPOSIT' where id = (select id from ord4);
select is(pg_temp.reserved('RT-X1') + pg_temp.reserved('RT-X3'), 3, 'a new order holds 3');
update public.orders set status = 'CANCELLED', cancelled_at = now(), cancel_reason = 'khách hủy' where id = (select id from ord4);
select is(pg_temp.reserved('RT-X1') + pg_temp.reserved('RT-X3'), 0, 'cancelling releases the hold');
select is((select distinct release_reason from public.inventory_reservations where order_id = (select id from ord4)), 'khách hủy', 'the cancel reason is kept on the release');

-- a missing TTL setting stops the confirmation with a clear message
delete from public.app_settings where key = 'reservation_ttl_hours';
create temp table ord5 as select pg_temp.mk_order(2) as id;
grant select on ord5 to public;
update public.orders set status = 'WAITING_CONFIRMATION' where id = (select id from ord5);
select throws_ok(
  $$update public.orders set status = 'WAITING_DEPOSIT' where id = (select id from ord5)$$,
  'P0001', null, 'WAITING_DEPOSIT requires the reservation TTL to be configured');
insert into public.app_settings (key, value) values ('reservation_ttl_hours', '24'::jsonb);

-- ---------------------------------------------------------------------------
-- Confirmed order: demand commitment, then physical allocation by Admin/Warehouse
-- ---------------------------------------------------------------------------
create temp table ord6 as select pg_temp.mk_order(10) as id;
grant select on ord6 to public;
update public.orders set status = 'WAITING_CONFIRMATION' where id = (select id from ord6);
update public.orders set status = 'WAITING_DEPOSIT' where id = (select id from ord6);
update public.orders set status = 'CONFIRMED', confirmed_at = now() where id = (select id from ord6);
select is((select count(*)::int from public.inventory_reservations where order_id = (select id from ord6) and status = 'ACTIVE'), 0, 'CONFIRMED replaces the temporary hold with demand commitment (no physical lock)');
select is((select reservation_expires_at is null from public.orders where id = (select id from ord6)), true, 'no hold expiry once confirmed');

select pg_temp.act_as_admin();
select is(
  (select committed_qty from public.committed_demand() where product_id = (select p from fx))::int, 10,
  'committed demand counts the confirmed, not yet allocated quantity');

select is(
  (public.allocate_order((select id from ord6)) ->> 'fully_allocated')::boolean, true, 'allocate_order allocates everything when stock allows');
select is((select status from public.orders where id = (select id from ord6)), 'RESERVED', 'a fully allocated order becomes RESERVED');
select is((select allocated_quantity from public.order_items where order_id = (select id from ord6)), 10, 'allocated_quantity = ordered quantity');
select is(
  (select committed_qty from public.committed_demand() where product_id = (select p from fx)), null,
  'an allocated order is no longer open demand');
select throws_ok($$select public.allocate_order((select id from ord6))$$, 'P0001', null, 'a RESERVED order cannot be allocated again');

-- partial allocation: needs more than sellable (19 - 10 = 9 left, safety already respected)
create temp table ord7 as select pg_temp.mk_order(15) as id;
grant select on ord7 to public;
update public.orders set status = 'WAITING_CONFIRMATION' where id = (select id from ord7);
update public.orders set status = 'WAITING_DEPOSIT' where id = (select id from ord7);
update public.orders set status = 'CONFIRMED', confirmed_at = now() where id = (select id from ord7);
select is((public.allocate_order((select id from ord7)) ->> 'shortage_total')::int, 6, 'a partial allocation reports the shortage');
select is((select status from public.orders where id = (select id from ord7)), 'CONFIRMED', 'a partially allocated order stays CONFIRMED');
select is((select allocated_quantity from public.order_items where order_id = (select id from ord7)), 9, 'only what is sellable is allocated');

-- The Admin override takes the 4 units of safety stock, but 2 are still missing
select is((public.allocate_order((select id from ord7), null, true) ->> 'shortage_total')::int, 2, 'with the Admin override only the safety stock is added (2 still missing)');
select is((select allocated_quantity from public.order_items where order_id = (select id from ord7)), 13, 'allocated_quantity now 13 of 15');

-- Who may allocate
select set_config('request.jwt.claim.sub', (select p2.id::text from public.profiles p2 join public.roles r on r.id = p2.role_id where r.code = 'SALE_B2B' and p2.is_active limit 1), true);
select throws_ok($$select public.allocate_order((select id from ord7))$$, '42501', null, 'sales users cannot allocate stock');
select set_config('request.jwt.claim.sub', (select p2.id::text from public.profiles p2 join public.roles r on r.id = p2.role_id where r.code = 'WAREHOUSE' and p2.is_active limit 1), true);
select throws_ok($$select public.allocate_order((select id from ord7), null, true)$$, '42501', null, 'warehouse cannot break safety stock');
select lives_ok($$select public.allocate_order((select id from ord7))$$, 'warehouse may allocate');

-- ---------------------------------------------------------------------------
-- Guards: reservations and the cache can only change through the engine
-- ---------------------------------------------------------------------------
select throws_ok($$update public.inventory_reservations set quantity = 999 where order_id = (select id from ord7)$$, 'P0001', null, 'a direct UPDATE of a reservation is refused');
select throws_ok($$delete from public.inventory_reservations where order_id = (select id from ord7)$$, 'P0001', null, 'reservations cannot be deleted');
select throws_ok(
  $$insert into public.inventory_reservations (order_id, order_item_id, location_id, product_id, batch_id, quantity, reservation_type)
    select (select id from ord7), id, (select a from fx), (select p from fx), pg_temp.batch('RT-X2'), 1, 'PHYSICAL_ALLOCATION' from public.order_items where order_id = (select id from ord7)$$,
  'P0001', null, 'a direct INSERT of a reservation is refused');
select throws_ok(
  $$update public.inventory_balances set reserved_qty = 3 where location_id = (select a from fx)$$,
  'P0001', null, 'reserved_qty cannot be edited directly');

-- ---------------------------------------------------------------------------
-- Reconciliation covers reserved_qty
-- ---------------------------------------------------------------------------
select pg_temp.act_as_admin();
select is((select count(*)::int from public.verify_inventory_balances()), 0, 'ledger, balances and reservations agree');
alter table public.inventory_balances disable trigger inventory_balances_guard_write;
update public.inventory_balances set reserved_qty = reserved_qty - 1
  where location_id = (select a from fx) and batch_id = pg_temp.batch('RT-X1') and reserved_qty > 0;
alter table public.inventory_balances enable trigger inventory_balances_guard_write;
select is((select count(*)::int from public.verify_inventory_balances() where column_name = 'reserved_qty'), 1, 'a drifted reserved_qty is detected');

-- ---------------------------------------------------------------------------
-- Shortage signal and source suggestions (RES-009, RES-010)
-- ---------------------------------------------------------------------------
select private.post_inventory_movement('ADJUSTMENT_IN', (select p from fx), pg_temp.batch('RT-X2'), null, (select b from fx), 10, 'fixture');
select private.post_inventory_movement('ADJUSTMENT_IN', (select p from fx), pg_temp.batch('RT-X2'), null, (select c from fx), 50, 'fixture');

select is(
  (select location_code from private.transfer_sources((select p from fx), (select a from fx), 8) limit 1),
  'RT-B', 'same region and enough stock ranks first');
select is(
  (select array_agg(location_code order by ord) from (select location_code, row_number() over () as ord from private.transfer_sources((select p from fx), (select a from fx), 8)) t),
  array['RT-B', 'RT-C'], 'then the other region');
select is(
  (select location_code from private.transfer_sources((select p from fx), (select a from fx), 30) limit 1),
  'RT-B', 'same region still comes first even if it cannot cover everything (priority 1 before 2)');
select is(
  (select covers_all from private.transfer_sources((select p from fx), (select a from fx), 30) where location_code = 'RT-C'),
  true, 'the far location can cover the whole need');
select is(
  (select count(*)::int from private.transfer_sources((select p from fx), (select b from fx), 1) where location_code = 'RT-B'),
  0, 'the destination is never suggested as its own source');

select set_config('request.jwt.claim.sub', (select p2.id::text from public.profiles p2 join public.roles r on r.id = p2.role_id where r.code = 'SALE_B2B' and p2.is_active limit 1), true);
select is(
  (public.check_stock((select a from fx), jsonb_build_array(jsonb_build_object('product_id', (select p from fx), 'quantity', 40))) -> 0 ->> 'shortage')::int,
  (select 40 - private.sellable_qty((select a from fx), (select p from fx))),
  'check_stock reports how many units are missing at the chosen location');
select is(
  (public.check_stock((select a from fx), jsonb_build_array(jsonb_build_object('product_id', (select p from fx), 'quantity', 40))) -> 0 -> 'suggestions' -> 0 ->> 'code'),
  'RT-B', 'and suggests the best source location');
select throws_ok($$select public.committed_demand()$$, '42501', null, 'sales users cannot read committed demand');

select * from finish();
rollback;
