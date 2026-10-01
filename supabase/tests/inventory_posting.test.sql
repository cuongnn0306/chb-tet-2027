-- pgTAP: inventory posting engine (INV-002..004). Run with: npx supabase test db
-- Everything runs in one transaction that is rolled back, so no data is left behind.
begin;
select plan(44);

-- Fixtures: two locations, one product, one batch.
insert into public.locations (code, name, location_type) values
  ('PGT-A', 'pgTAP A', 'STORE'), ('PGT-B', 'pgTAP B', 'STORE');
insert into public.products (sku, name, list_price) values ('PGT-SKU', 'pgTAP product', 1000);
insert into public.product_batches (batch_code, product_id, manufactured_date, expiry_date)
select 'PGT-B1', id, current_date, current_date + 30 from public.products where sku = 'PGT-SKU';
insert into public.products (sku, name, list_price) values ('PGT-OTHER', 'other product', 1000);

create temp table fx as
select
  (select id from public.locations where code = 'PGT-A') as a,
  (select id from public.locations where code = 'PGT-B') as b,
  (select id from public.products where sku = 'PGT-SKU') as p,
  (select id from public.products where sku = 'PGT-OTHER') as other_p,
  (select pb.id from public.product_batches pb join public.products pr on pr.id = pb.product_id
    where pr.sku = 'PGT-SKU' and pb.batch_code = 'PGT-B1') as batch;
grant select on fx to public;

create function pg_temp.bal(loc text, col text) returns int language plpgsql as $$
declare v int;
begin
  execute format(
    'select %I from public.inventory_balances where location_id = (select %I from fx) and product_id = (select p from fx) and batch_id = (select batch from fx)',
    col, loc) into v;
  return coalesce(v, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Basic in / out
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select private.post_inventory_movement('ADJUSTMENT_IN', (select p from fx), (select batch from fx), null, (select a from fx), 100, 'pgTAP')$$,
  'ADJUSTMENT_IN posts');
select is(pg_temp.bal('a', 'available_qty'), 100, 'available = 100 after adjustment in');

select lives_ok(
  $$select private.post_inventory_movement('SALE_OUT', (select p from fx), (select batch from fx), (select a from fx), null, 30)$$,
  'SALE_OUT posts');
select is(pg_temp.bal('a', 'available_qty'), 70, 'available = 70 after sale out');

-- ---------------------------------------------------------------------------
-- No negative stock
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select private.post_inventory_movement('SALE_OUT', (select p from fx), (select batch from fx), (select a from fx), null, 71)$$,
  'P0001', null, 'taking more than available is refused');
select is(pg_temp.bal('a', 'available_qty'), 70, 'balance unchanged after a refused movement');
select is(
  (select count(*)::int from public.inventory_movements where batch_id = (select batch from fx)), 2,
  'a refused movement leaves no ledger row');
select throws_ok(
  $$select private.post_inventory_movement('SALE_OUT', (select p from fx), (select batch from fx), (select b from fx), null, 1)$$,
  'P0001', null, 'taking from a location with no stock is refused');
select throws_ok(
  $$select private.post_inventory_movement('SALE_OUT', (select p from fx), (select batch from fx), (select a from fx), null, 0)$$,
  'P0001', null, 'zero quantity is refused');
select throws_ok(
  $$select private.post_inventory_movement('SALE_OUT', (select p from fx), (select batch from fx), (select a from fx), null, -5)$$,
  'P0001', null, 'negative quantity is refused');
select lives_ok(
  $$select private.post_inventory_movement('ADJUSTMENT_OUT', (select p from fx), (select batch from fx), (select a from fx), null, 70, 'đếm lại')$$,
  'taking exactly what is there works');
select is(pg_temp.bal('a', 'available_qty'), 0, 'available = 0 (never negative)');
select lives_ok(
  $$select private.post_inventory_movement('ADJUSTMENT_IN', (select p from fx), (select batch from fx), null, (select a from fx), 70, 'trả lại')$$,
  'restore stock');

-- ---------------------------------------------------------------------------
-- Every movement type moves the right counters
-- ---------------------------------------------------------------------------
select private.post_inventory_movement('DAMAGE_OUT', (select p from fx), (select batch from fx), (select a from fx), null, 10, 'vỡ');
select is(pg_temp.bal('a', 'available_qty'), 60, 'DAMAGE_OUT: available -10');
select is(pg_temp.bal('a', 'damaged_qty'), 10, 'DAMAGE_OUT: damaged +10');

select private.post_inventory_movement('SAMPLE_OUT', (select p from fx), (select batch from fx), (select a from fx), null, 5, 'mẫu');
select private.post_inventory_movement('GIFT_OUT', (select p from fx), (select batch from fx), (select a from fx), null, 5, 'biếu');
select is(pg_temp.bal('a', 'available_qty'), 50, 'SAMPLE/GIFT_OUT: available -10 in total');
select is(pg_temp.bal('a', 'sample_qty') + pg_temp.bal('a', 'gift_qty'), 10, 'sample 5 + gift 5 tracked');

select private.post_inventory_movement('TRANSFER_OUT', (select p from fx), (select batch from fx), (select a from fx), (select b from fx), 20);
select is(pg_temp.bal('a', 'available_qty'), 30, 'TRANSFER_OUT: source available -20');
select is(pg_temp.bal('b', 'in_transfer_qty'), 20, 'TRANSFER_OUT: destination in transit +20');
select is(pg_temp.bal('b', 'available_qty'), 0, 'in-transit stock is not available yet');

select private.post_inventory_movement('TRANSFER_IN', (select p from fx), (select batch from fx), (select a from fx), (select b from fx), 15);
select is(pg_temp.bal('b', 'in_transfer_qty'), 5, 'TRANSFER_IN: in transit -15');
select is(pg_temp.bal('b', 'available_qty'), 15, 'TRANSFER_IN: destination available +15');
select throws_ok(
  $$select private.post_inventory_movement('TRANSFER_IN', (select p from fx), (select batch from fx), (select a from fx), (select b from fx), 6)$$,
  'P0001', null, 'receiving more than is in transit is refused');

select private.post_inventory_movement('RETURN_IN', (select p from fx), (select batch from fx), null, (select b from fx), 8, 'khách trả');
select is(pg_temp.bal('b', 'pending_inspection_qty'), 8, 'RETURN_IN: pending inspection +8');
select is(pg_temp.bal('b', 'available_qty'), 15, 'returned stock is NOT available until inspected');
select private.post_inventory_movement('INSPECTION_TO_AVAILABLE', (select p from fx), (select batch from fx), null, (select b from fx), 3);
select private.post_inventory_movement('INSPECTION_TO_DAMAGED', (select p from fx), (select batch from fx), null, (select b from fx), 2);
select is(pg_temp.bal('b', 'pending_inspection_qty'), 3, 'inspection: pending 8 - 3 - 2 = 3');
select is(pg_temp.bal('b', 'available_qty'), 18, 'inspection: restocked 3');
select is(pg_temp.bal('b', 'damaged_qty'), 2, 'inspection: damaged 2');
select throws_ok(
  $$select private.post_inventory_movement('INSPECTION_TO_AVAILABLE', (select p from fx), (select batch from fx), null, (select b from fx), 4)$$,
  'P0001', null, 'inspecting more than is pending is refused');

-- ---------------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select private.post_inventory_movement('ADJUSTMENT_IN', (select other_p from fx), (select batch from fx), null, (select a from fx), 1, 'x')$$,
  'P0001', null, 'a batch of another product is refused');
select throws_ok(
  $$select private.post_inventory_movement('TELEPORT', (select p from fx), (select batch from fx), null, (select a from fx), 1)$$,
  null, null, 'an unknown movement type is refused');
select throws_ok(
  $$select private.post_inventory_movement('ADJUSTMENT_IN', (select p from fx), (select batch from fx), null, (select a from fx), 1)$$,
  '23514', null, 'an adjustment without a reason violates the ledger rule');

-- ---------------------------------------------------------------------------
-- The ledger and the cache are protected from everything except the posting function
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.inventory_balances set available_qty = available_qty + 1 where location_id = (select a from fx)$$,
  'P0001', null, 'a direct UPDATE of balances is refused');
select throws_ok(
  $$insert into public.inventory_balances (location_id, product_id, batch_id, available_qty)
    select a, other_p, batch, 5 from fx$$,
  'P0001', null, 'a direct INSERT into balances is refused');
select throws_ok(
  $$delete from public.inventory_balances where location_id = (select a from fx)$$,
  'P0001', null, 'a DELETE of balances is refused');
select throws_ok(
  $$insert into public.inventory_movements (movement_type, product_id, batch_id, to_location_id, quantity, reason)
    select 'ADJUSTMENT_IN', p, batch, a, 5, 'trực tiếp' from fx$$,
  'P0001', null, 'a direct INSERT into the ledger is refused');
select throws_ok(
  $$update public.inventory_movements set quantity = 999 where batch_id = (select batch from fx)$$,
  'P0001', null, 'ledger rows cannot be updated');
select throws_ok(
  $$delete from public.inventory_movements where batch_id = (select batch from fx)$$,
  'P0001', null, 'ledger rows cannot be deleted');

-- CHECK constraints are the last line of defence even when the flag is on.
select set_config('app.inventory_posting', 'on', true);
select throws_ok(
  $$update public.inventory_balances set available_qty = -1 where location_id = (select b from fx)$$,
  '23514', null, 'negative available is impossible');
select throws_ok(
  $$update public.inventory_balances set reserved_qty = available_qty + 1 where location_id = (select b from fx)$$,
  '23514', null, 'reserved can never exceed available');
select set_config('app.inventory_posting', 'off', true);

-- Batches with movements are frozen and cannot be deleted
select throws_ok(
  $$update public.product_batches set expiry_date = expiry_date + 1 where id = (select batch from fx)$$,
  'P0001', null, 'a batch with movements cannot change its dates');
select throws_ok(
  $$delete from public.product_batches where id = (select batch from fx)$$,
  'P0001', null, 'a batch cannot be deleted');

-- ---------------------------------------------------------------------------
-- Reconciliation: ledger == cache; tampering is detected
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', (select p.id::text from public.profiles p join public.roles r on r.id = p.role_id where r.code = 'ADMIN' and p.is_active limit 1), true);
select is((select count(*)::int from public.verify_inventory_balances()), 0, 'reconciliation finds no mismatch after all movements');

alter table public.inventory_balances disable trigger inventory_balances_guard_write;
update public.inventory_balances set available_qty = available_qty + 1 where location_id = (select b from fx);
alter table public.inventory_balances enable trigger inventory_balances_guard_write;
select is(
  (select count(*)::int from public.verify_inventory_balances() where column_name = 'available_qty'), 1,
  'reconciliation detects a tampered cache');

select * from finish();
rollback;
