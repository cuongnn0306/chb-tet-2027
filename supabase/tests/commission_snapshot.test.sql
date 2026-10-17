-- pgTAP: COM-002 estimated commission and the first-confirmation per-item snapshot.
-- Run with: npx supabase test db. Everything happens in one transaction that is rolled back.
--
-- Fixture arithmetic (store seller, product default rates, no rules): gross lines 33.333 / 30.003 / 6.993,
-- rates 7,5% / 12,34% / 0%.
--   base x 10000   = 24.999.750 / 37.023.702 / 0   -> floors 2499 / 3702 / 0 ; target floor(6202,3452) = 6202
--   leftover 1 unit goes to the largest remainder (CS-A, .975)  -> 2500 / 3702 / 0
--   discount 5.000 split 33333:30003:6993 of 70329 -> floors 2369 / 2133 / 497, +1 to CS-A -> 2370 / 2133 / 497
--   discount 6.202 (= ceiling)                      -> floors 2939 / 2645 / 616, +1 to CS-B and CS-C -> 2939 / 2646 / 617
-- Owner decision 17/10/2026: payable commission is never negative. The commission deduction starts from
-- min(share, base) = 2370 / 2133 / 0 and the 497 the 0% line cannot fund is spread over the rooms 130 / 1569 / 0:
--   497 x 130/1699 = 38,03 and 497 x 1569/1699 = 458,97 -> +38 and +459 (largest remainder) -> deductions 2408 / 2592 / 0,
--   payable 92 / 1110 / 0 (sum 1202 = base - discount). The customer discount shares stay 2370 / 2133 / 497.
begin;
select * from no_plan();

insert into public.products (sku, name, list_price, default_commission_rate) values
  ('CS-A', 'CS product A', 33333, 7.5),
  ('CS-B', 'CS product B', 10001, 12.34),
  ('CS-C', 'CS product C', 6993, 0);

-- A deposit of 0 makes the Admin's confirmation land on CONFIRMED straight away (the snapshot moment).
update public.app_settings set value = '"PERCENT"'::jsonb where key = 'default_deposit_type';
update public.app_settings set value = '0'::jsonb where key = 'default_deposit_value';

-- Controlled rule set: switch off every existing rule (seed or leftovers) and add one role-wide Sale B2B rule.
update public.commission_rules set is_active = false;
create temp table seed_role_rule as
with ins as (
  insert into public.commission_rules (role_id, rate_percent, effective_from)
  values ((select id from public.roles where code = 'SALE_B2B'), 7, date '2000-01-01')
  returning id, effective_from, effective_to
)
select id, effective_from, effective_to from ins;
grant select on seed_role_rule to public;

create temp table fx as
select
  (select id from public.products where sku = 'CS-A') as pa,
  (select id from public.products where sku = 'CS-B') as pb,
  (select id from public.products where sku = 'CS-C') as pc,
  (select p.id from public.profiles p join public.roles r on r.id = p.role_id where r.code = 'ADMIN' and p.is_active limit 1) as admin_id,
  (select p.id from public.profiles p join public.roles r on r.id = p.role_id where r.code = 'SALE_B2B' and p.is_active limit 1) as sale_id,
  (select p.id from public.profiles p join public.roles r on r.id = p.role_id where r.code = 'STORE_STAFF' and p.is_active limit 1) as store_id,
  (select p.id from public.profiles p join public.roles r on r.id = p.role_id where r.code = 'WAREHOUSE' and p.is_active limit 1) as warehouse_id,
  (select id from public.roles where code = 'SALE_B2B') as sale_role_id,
  (select id from public.roles where code = 'STORE_STAFF') as store_role_id,
  (select id from public.customers where phone_normalized = '0900000003') as customer_id;
grant select on fx to public;

select ok((select count(*) from fx where pa is not null and pb is not null and pc is not null and admin_id is not null
  and sale_id is not null and store_id is not null and warehouse_id is not null and customer_id is not null) = 1,
  'fixtures: products, one profile per role and a customer exist');

create function pg_temp.as_user(p_id uuid) returns text language sql as
  $$ select set_config('request.jwt.claim.sub', coalesce(p_id::text, ''), true) $$;

create function pg_temp.items_abc() returns jsonb language sql as
  $$ select jsonb_build_array(
       jsonb_build_object('product_id', (select pa from fx), 'quantity', 1),
       jsonb_build_object('product_id', (select pb from fx), 'quantity', 3),
       jsonb_build_object('product_id', (select pc from fx), 'quantity', 1)) $$;

create function pg_temp.items_ab() returns jsonb language sql as
  $$ select jsonb_build_array(
       jsonb_build_object('product_id', (select pa from fx), 'quantity', 1),
       jsonb_build_object('product_id', (select pb from fx), 'quantity', 3)) $$;

create function pg_temp.draft_order(p_owner uuid, p_items jsonb, p_discount bigint) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform pg_temp.as_user(p_owner);
  select o.id into v_id from public.save_draft_order(null, (select customer_id from fx), p_items, p_discount) o;
  return v_id;
end;
$$;

create function pg_temp.submit_order(p_id uuid, p_owner uuid) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_owner);
  perform public.transition_order(p_id, 'submit');
end;
$$;

-- The Admin's confirmation (deposit 0): WAITING_CONFIRMATION -> WAITING_DEPOSIT -> CONFIRMED in one transaction.
create function pg_temp.admin_confirm(p_id uuid) returns void language plpgsql as $$
begin
  perform pg_temp.as_user((select admin_id from fx));
  perform public.transition_order(p_id, 'confirm');
end;
$$;

create function pg_temp.estimate_as(p_user uuid, p_order uuid) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return public.estimate_order_commission(p_order);
end;
$$;

create function pg_temp.line_ints(p_j jsonb, p_key text) returns bigint[] language sql as
  $$ select array_agg((t.l ->> p_key)::bigint order by t.ord) from jsonb_array_elements(p_j -> 'lines') with ordinality as t(l, ord) $$;
create function pg_temp.line_nums(p_j jsonb, p_key text) returns numeric[] language sql as
  $$ select array_agg((t.l ->> p_key)::numeric order by t.ord) from jsonb_array_elements(p_j -> 'lines') with ordinality as t(l, ord) $$;
create function pg_temp.line_texts(p_j jsonb, p_key text) returns text[] language sql as
  $$ select array_agg(t.l ->> p_key order by t.ord) from jsonb_array_elements(p_j -> 'lines') with ordinality as t(l, ord) $$;

create temp view snap as
select s.*, pr.sku
from public.order_item_commission_snapshots s
join public.products pr on pr.id = s.product_id;

create function pg_temp.snap_ints(p_order uuid, p_col text) returns bigint[] language plpgsql as $$
declare
  v bigint[];
begin
  execute format('select array_agg(%I::bigint order by sku collate "C") from snap where order_id = $1', p_col) into v using p_order;
  return v;
end;
$$;
create function pg_temp.snap_nums(p_order uuid, p_col text) returns numeric[] language plpgsql as $$
declare
  v numeric[];
begin
  execute format('select array_agg(%I::numeric order by sku collate "C") from snap where order_id = $1', p_col) into v using p_order;
  return v;
end;
$$;
create function pg_temp.snap_texts(p_order uuid, p_col text) returns text[] language plpgsql as $$
declare
  v text[];
begin
  execute format('select array_agg(%I::text order by sku collate "C") from snap where order_id = $1', p_col) into v using p_order;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- The estimate base equals the ORD-005 discount ceiling (one rounding rule for both)
-- ---------------------------------------------------------------------------
select is(
  private.discount_ceiling(array[33333, 30003, 6993]::bigint[], array[7.5, 12.34, 0]::numeric[]),
  6202::bigint,
  'fixture: the discount ceiling of the sample order is floor(6202,3452) = 6202'
);

-- ---------------------------------------------------------------------------
-- Order 1 (store seller): the estimate follows today's rules until the first confirmation
-- ---------------------------------------------------------------------------
create temp table o1 as select pg_temp.draft_order((select store_id from fx), pg_temp.items_abc(), 5000) as id;
grant select on o1 to public;

create temp table e1 as select pg_temp.estimate_as((select store_id from fx), (select id from o1)) as j;
grant select on e1 to public;

select is((select j ->> 'basis' from e1), 'ESTIMATE', 'a draft shows an ESTIMATE');
select is((select (j ->> 'is_final')::boolean from e1), false, 'an estimate is not final');
select is((select (j ->> 'base_commission')::bigint from e1), 6202::bigint, 'estimated base commission = floor(sum(gross x rate))');
select is((select (j ->> 'final_commission')::bigint from e1), 1202::bigint, 'estimated final commission = base - discount');
select is((select (j ->> 'discount_within_base_commission')::boolean from e1), true, 'the discount is within the base commission');
select is((select j ->> 'resolved_on' from e1), private.business_today()::text, 'the estimate is resolved on the Vietnam business date');
select is((select j ->> 'seller_role_code' from e1), 'STORE_STAFF', 'the estimate names the seller''s current role');
select is(pg_temp.line_ints((select j from e1), 'commission_revenue'), array[33333, 30003, 6993]::bigint[], 'commission revenue = list price x quantity per line');
select is(pg_temp.line_nums((select j from e1), 'rate_percent'), array[7.5, 12.34, 0]::numeric[], 'rates come from the product defaults (0% is honoured)');
select is(pg_temp.line_texts((select j from e1), 'rule_source'), array['PRODUCT_DEFAULT', 'PRODUCT_DEFAULT', 'PRODUCT_DEFAULT'], 'rule sources: product defaults');
select is(pg_temp.line_ints((select j from e1), 'base_commission'), array[2500, 3702, 0]::bigint[], 'base commission per line: the leftover unit goes to the largest remainder');
select is(pg_temp.line_ints((select j from e1), 'customer_discount_share'), array[2370, 2133, 497]::bigint[], 'discount shares follow the gross line amounts');
select is(pg_temp.line_ints((select j from e1), 'commission_deduction'), array[2408, 2592, 0]::bigint[], 'the 0% line''s share is funded by the other lines, not deducted from itself');
select is(pg_temp.line_ints((select j from e1), 'payable_commission'), array[92, 1110, 0]::bigint[], 'payable per line is base - deduction and never negative');
select is(pg_temp.line_ints((select j from e1), 'final_commission'), array[92, 1110, 0]::bigint[], 'final_commission reports the payable figure');
select is((select (j ->> 'commission_funded_discount')::bigint from e1), 5000::bigint, 'an ordinary order funds the whole discount from commission');
select is((select (j ->> 'company_borne_excess')::bigint from e1), 0::bigint, 'and the company bears nothing');
select is((select j -> 'commission_locked' from e1), 'false'::jsonb, 'an estimate is never locked by an exception');
select is((select count(*) from public.order_item_commission_snapshots where order_id = (select id from o1)), 0::bigint, 'an estimate stores nothing');

-- A new user+product rule changes the estimate immediately (it is not a snapshot).
create temp table r1 as
with ins as (
  insert into public.commission_rules (user_id, product_id, rate_percent, effective_from)
  values ((select store_id from fx), (select pa from fx), 10, date '2000-01-01')
  returning id
)
select id from ins;
grant select on r1 to public;

create temp table e2 as select pg_temp.estimate_as((select store_id from fx), (select id from o1)) as j;
create temp table e2a as select pg_temp.estimate_as((select admin_id from fx), (select id from o1)) as j;
grant select on e2 to public;
grant select on e2a to public;

select is(pg_temp.line_nums((select j from e2), 'rate_percent'), array[10, 12.34, 0]::numeric[], 'a rule created before confirmation changes the estimate');
select is(pg_temp.line_texts((select j from e2), 'rule_source'), array['USER_PRODUCT', 'PRODUCT_DEFAULT', 'PRODUCT_DEFAULT'], 'the user+product rule outranks the default');
select is(pg_temp.line_ints((select j from e2), 'base_commission'), array[3333, 3702, 0]::bigint[], 'the new rate flows into the line commissions');
select is((select (j ->> 'base_commission')::bigint from e2), 7035::bigint, 'the order-level base follows (floor(7035,6702))');
select is((select j -> 'lines' -> 0 ->> 'rule_id' from e2), null, 'the salesperson does not see the rule id (Admin-only evidence)');
select is((select j -> 'lines' -> 0 ->> 'rule_id' from e2a), (select id::text from r1), 'the Admin sees the rule that produced the rate');

-- A rate cut can leave the discount above the base commission: the estimate says so instead of hiding it.
update public.commission_rules set rate_percent = 1 where id = (select id from r1);
create temp table e3 as select pg_temp.estimate_as((select store_id from fx), (select id from o1)) as j;
grant select on e3 to public;
select is((select (j ->> 'base_commission')::bigint from e3), 4035::bigint, 'after a rate cut the base is floor(4035,7002)');
select is((select (j ->> 'discount_within_base_commission')::boolean from e3), false, 'the estimate flags a discount above the base commission');
-- Base 333 / 3702 / 0 = 4035; the discount 5000 leaves 965 that the commission cannot fund.
select is((select (j ->> 'commission_funded_discount')::bigint from e3), 4035::bigint, 'the commission funds at most its whole base');
select is((select (j ->> 'company_borne_excess')::bigint from e3), 965::bigint, 'the company bears the rest, explicitly');
select is((select (j ->> 'final_commission')::bigint from e3), 0::bigint, 'the employee''s payable commission is zero, not negative');
select is(pg_temp.line_ints((select j from e3), 'payable_commission'), array[0, 0, 0]::bigint[], 'no line goes negative');
select is(pg_temp.line_ints((select j from e3), 'customer_discount_share'), array[2370, 2133, 497]::bigint[], 'the customer still gets the whole discount, per line');

update public.commission_rules set is_active = false where id = (select id from r1);
create temp table e4 as select pg_temp.estimate_as((select store_id from fx), (select id from o1)) as j;
grant select on e4 to public;
select is(pg_temp.line_ints((select j from e4), 'base_commission'), array[2500, 3702, 0]::bigint[], 'deactivating the rule restores the previous estimate');

-- Still an estimate after submitting (waiting for the Admin).
select pg_temp.submit_order((select id from o1), (select store_id from fx));
select is((select status from public.orders where id = (select id from o1)), 'WAITING_CONFIRMATION', 'fixture: order 1 waits for the Admin');
select is(pg_temp.estimate_as((select store_id from fx), (select id from o1)) ->> 'basis', 'ESTIMATE', 'a submitted order is still an estimate');
select is((select count(*) from public.order_item_commission_snapshots where order_id = (select id from o1)), 0::bigint, 'nothing is snapshotted before the Admin confirms');

-- ---------------------------------------------------------------------------
-- First confirmation: the snapshot is written atomically with the status change
-- ---------------------------------------------------------------------------
select pg_temp.admin_confirm((select id from o1));

select is((select status from public.orders where id = (select id from o1)), 'CONFIRMED', 'the order is CONFIRMED');
select is((select count(*) from public.order_item_commission_snapshots where order_id = (select id from o1)), 3::bigint, 'one snapshot row per order line');
select is(pg_temp.snap_nums((select id from o1), 'rate_percent'), array[7.5, 12.34, 0]::numeric[], 'snapshot rates');
select is(pg_temp.snap_texts((select id from o1), 'rule_source'), array['PRODUCT_DEFAULT', 'PRODUCT_DEFAULT', 'PRODUCT_DEFAULT'], 'snapshot rule evidence: product defaults');
select ok((select bool_and(rule_id is null) from snap where order_id = (select id from o1)), 'no commission rule id when the product default applied');
select is(pg_temp.snap_ints((select id from o1), 'commission_revenue'), array[33333, 30003, 6993]::bigint[], 'snapshot commission revenue = list price x quantity');
select is(pg_temp.snap_ints((select id from o1), 'base_commission'), array[2500, 3702, 0]::bigint[], 'snapshot base commission per line');
select is(pg_temp.snap_ints((select id from o1), 'customer_discount_share'), array[2370, 2133, 497]::bigint[], 'snapshot discount share per line');
select is(pg_temp.snap_ints((select id from o1), 'commission_deduction'), array[2408, 2592, 0]::bigint[], 'snapshot commission deduction per line');
select is(pg_temp.snap_ints((select id from o1), 'payable_commission'), array[92, 1110, 0]::bigint[], 'snapshot payable commission per line, nonnegative');
select is(pg_temp.snap_ints((select id from o1), 'allocation_version'), array[2, 2, 2]::bigint[], 'new snapshots use allocation version 2');
select is((select sum(base_commission)::bigint from snap where order_id = (select id from o1)), 6202::bigint, 'line base commissions add up to the order ceiling');
select is((select sum(customer_discount_share)::bigint from snap where order_id = (select id from o1)),
  (select discount_amount from public.orders where id = (select id from o1)), 'line discount shares add up to the order discount exactly');
select is((select sum(payable_commission)::bigint from snap where order_id = (select id from o1)), 1202::bigint, 'line payable commissions add up to base - discount');
select is((select sum(commission_deduction)::bigint from snap where order_id = (select id from o1)),
  (select discount_amount from public.orders where id = (select id from o1)), 'deductions plus a zero company excess add up to the whole discount');
select ok((select bool_and(commission_deduction between 0 and base_commission) from snap where order_id = (select id from o1)), 'every deduction stays within its line''s base commission');
select is((select count(*) from public.commission_discount_exceptions where order_id = (select id from o1)), 0::bigint, 'an ordinary order needs no exception');
select is(private.commission_is_locked((select id from o1)), false, 'and its commission is not locked');
select is((select count(distinct seller_user_id) from snap where order_id = (select id from o1)), 1::bigint, 'one seller on the snapshot');
select is((select min(seller_user_id::text) from snap where order_id = (select id from o1)), (select store_id::text from fx), 'the seller is the order owner');
select is((select min(seller_role_code) from snap where order_id = (select id from o1)), 'STORE_STAFF', 'the seller''s role at confirmation is recorded');
select is((select min(seller_role_id::text) from snap where order_id = (select id from o1)), (select store_role_id::text from fx), 'the seller''s role id is recorded');
select ok((select bool_and(resolved_on = private.business_today()) from snap where order_id = (select id from o1)), 'rates were resolved on the confirmation business date');
select is((select min(snapshot_by::text) from snap where order_id = (select id from o1)), (select admin_id::text from fx), 'the confirming Admin is recorded');
select ok(exists (select 1 from public.audit_logs where entity_type = 'order_item_commission_snapshots'
  and entity_id in (select id from snap where order_id = (select id from o1))), 'creating a snapshot is audited');
select is((select count(*) from public.order_status_history where order_id = (select id from o1) and to_status = 'CONFIRMED'), 1::bigint, 'the order entered CONFIRMED once');
select is((select gross_amount || '/' || discount_amount || '/' || net_amount from public.orders where id = (select id from o1)), '70329/5000/65329', 'order amounts are untouched by the snapshot');

create temp table e5 as select pg_temp.estimate_as((select store_id from fx), (select id from o1)) as j;
grant select on e5 to public;
select is((select j ->> 'basis' from e5), 'SNAPSHOT', 'a confirmed order reports its snapshot');
select is((select (j ->> 'is_final')::boolean from e5), true, 'the snapshot is final');
select is(pg_temp.line_ints((select j from e5), 'base_commission'), array[2500, 3702, 0]::bigint[], 'snapshot figures are served from the stored rows');

-- ---------------------------------------------------------------------------
-- Order 2: discount equal to the ceiling -> several leftover units, final commission 0 in total
-- ---------------------------------------------------------------------------
create temp table o2 as select pg_temp.draft_order((select store_id from fx), pg_temp.items_abc(), 6202) as id;
grant select on o2 to public;
select pg_temp.submit_order((select id from o2), (select store_id from fx));
select pg_temp.admin_confirm((select id from o2));
select is((select status from public.orders where id = (select id from o2)), 'CONFIRMED', 'fixture: order 2 is CONFIRMED');
select is(pg_temp.snap_ints((select id from o2), 'customer_discount_share'), array[2939, 2646, 617]::bigint[], 'discount equal to the ceiling: leftover units go to the largest remainders');
select is(pg_temp.snap_ints((select id from o2), 'commission_deduction'), array[2500, 3702, 0]::bigint[], 'the 617 of the 0% line is funded by the room of the other lines');
select is(pg_temp.snap_ints((select id from o2), 'payable_commission'), array[0, 0, 0]::bigint[], 'no line goes negative');
select is((select sum(payable_commission)::bigint from snap where order_id = (select id from o2)), 0::bigint, 'the employee keeps nothing when the discount uses the whole commission');
select is((select count(*) from public.commission_discount_exceptions where order_id = (select id from o2)), 0::bigint, 'a discount equal to the ceiling needs no exception');

-- ---------------------------------------------------------------------------
-- Order 3: a Sale B2B seller resolved through the role-wide rule (7%) records the rule as evidence
-- ---------------------------------------------------------------------------
create temp table o3 as select pg_temp.draft_order((select sale_id from fx), pg_temp.items_ab(), 0) as id;
grant select on o3 to public;
select pg_temp.submit_order((select id from o3), (select sale_id from fx));
select pg_temp.admin_confirm((select id from o3));

select is((select count(*) from public.commission_rules where is_active and role_id = (select sale_role_id from fx)
  and product_id is null and user_id is null), 1::bigint, 'fixture: exactly one active role-wide Sale B2B rule');

select is(pg_temp.snap_nums((select id from o3), 'rate_percent'), array[7, 7]::numeric[], 'role-wide rule rate is snapshotted');
select is(pg_temp.snap_texts((select id from o3), 'rule_source'), array['ROLE', 'ROLE'], 'evidence: the role-wide rule');
select is(pg_temp.snap_texts((select id from o3), 'rule_id'), array[(select id::text from seed_role_rule), (select id::text from seed_role_rule)], 'evidence: the rule id');
select is((select min(rule_effective_from) from snap where order_id = (select id from o3)), (select effective_from from seed_role_rule), 'evidence: the rule period start');
select is(pg_temp.snap_ints((select id from o3), 'base_commission'), array[2333, 2100]::bigint[], 'base commission 7%: floors 2333 + 2100 = floor(4433,52)');
select is(pg_temp.snap_ints((select id from o3), 'customer_discount_share'), array[0, 0]::bigint[], 'no discount, no shares');
select is((select min(seller_role_code) from snap where order_id = (select id from o3)), 'SALE_B2B', 'seller role code: Sale B2B');

-- ---------------------------------------------------------------------------
-- Permissions: only the salesperson and the Admin read an order's commission
-- ---------------------------------------------------------------------------
select is(pg_temp.estimate_as((select sale_id from fx), (select id from o3)) ->> 'basis', 'SNAPSHOT', 'the salesperson reads their own order');
select is(pg_temp.estimate_as((select admin_id from fx), (select id from o1)) ->> 'basis', 'SNAPSHOT', 'the Admin reads any order');
select pg_temp.as_user((select sale_id from fx));
select throws_ok($$select public.estimate_order_commission((select id from o1))$$, '42501',
  'Không tìm thấy đơn hàng hoặc bạn không có quyền xem hoa hồng của đơn này.', 'another salesperson cannot read the order''s commission');
select pg_temp.as_user((select warehouse_id from fx));
select throws_ok($$select public.estimate_order_commission((select id from o1))$$, '42501',
  'Không tìm thấy đơn hàng hoặc bạn không có quyền xem hoa hồng của đơn này.', 'Warehouse cannot read commission');
select pg_temp.as_user((select store_id from fx));
select throws_ok($$select public.estimate_order_commission(gen_random_uuid())$$, '42501',
  'Không tìm thấy đơn hàng hoặc bạn không có quyền xem hoa hồng của đơn này.', 'an unknown order answers like a forbidden one');

create temp table exp as
select (select count(*) from public.order_item_commission_snapshots) as n_all;
grant select on exp to public;
select ok((select n_all from exp) >= 8, 'fixture: orders 1 to 3 left at least eight snapshotted lines (3 + 3 + 2)');

set local role authenticated;

select pg_temp.as_user((select store_id from fx));
select is((select count(*) from public.order_item_commission_snapshots), 0::bigint,
  'a salesperson does not read the table directly (rule evidence is Admin data; they use the RPC)');
select throws_ok($$insert into public.order_item_commission_snapshots (order_id, order_item_id, product_id, seller_user_id, seller_role_id,
    seller_role_code, quantity, commission_revenue, rate_percent, rule_source, resolved_on, base_commission, customer_discount_share)
  select order_id, order_item_id, product_id, seller_user_id, seller_role_id, seller_role_code, quantity, commission_revenue,
    rate_percent, rule_source, resolved_on, base_commission, customer_discount_share from public.order_item_commission_snapshots limit 1$$,
  '42501', null, 'a direct INSERT is refused for a signed-in user');
select throws_ok($$update public.order_item_commission_snapshots set rate_percent = 100$$, '42501', null, 'a direct UPDATE is refused for a signed-in user');
select throws_ok($$delete from public.order_item_commission_snapshots$$, '42501', null, 'a direct DELETE is refused for a signed-in user');

select pg_temp.as_user((select sale_id from fx));
select is((select count(*) from public.order_item_commission_snapshots), 0::bigint, 'the seller of order 3 does not read the table directly either');

select pg_temp.as_user((select warehouse_id from fx));
select is((select count(*) from public.order_item_commission_snapshots), 0::bigint, 'Warehouse reads no snapshots');

select pg_temp.as_user((select admin_id from fx));
select is((select count(*) from public.order_item_commission_snapshots), (select n_all from exp), 'the Admin reads every snapshot');
select throws_ok($$update public.order_item_commission_snapshots set rate_percent = 100$$, '42501', null, 'even the Admin cannot UPDATE through the API role');

reset role;

-- ---------------------------------------------------------------------------
-- Later rule, role and product edits never rewrite a confirmed order
-- ---------------------------------------------------------------------------
create temp table snap_before as select * from public.order_item_commission_snapshots;
grant select on snap_before to public;

insert into public.commission_rules (user_id, product_id, rate_percent, effective_from)
values ((select store_id from fx), (select pa from fx), 20, date '2000-01-01');
update public.commission_rules set rate_percent = 20 where id = (select id from seed_role_rule);
update public.profiles set role_id = (select sale_role_id from fx) where id = (select store_id from fx);
update public.products set default_commission_rate = 50 where id in (select pa from fx union select pb from fx union select pc from fx);

select is((select count(*) from public.order_item_commission_snapshots), (select count(*) from snap_before), 'no snapshot row appeared or disappeared');
select is((select count(*) from (select * from public.order_item_commission_snapshots except select * from snap_before) x), 0::bigint,
  'no snapshot row changed after rule, role and product-default edits');
select is(pg_temp.estimate_as((select store_id from fx), (select id from o1)) -> 'lines', (select j -> 'lines' from e5), 'order 1 still reports the same line figures');
select is(pg_temp.estimate_as((select store_id from fx), (select id from o1)) ->> 'seller_role_code', 'STORE_STAFF', 'order 1 keeps the seller role from confirmation');
select is(pg_temp.snap_nums((select id from o3), 'rate_percent'), array[7, 7]::numeric[], 'order 3 keeps its 7% although the role rule is now 20%');
select is(pg_temp.snap_ints((select id from o3), 'base_commission'), array[2333, 2100]::bigint[], 'order 3 base commission unchanged');
select is(pg_temp.snap_ints((select id from o2), 'payable_commission'), array[0, 0, 0]::bigint[], 'order 2 payable commission unchanged');

-- Repeating the snapshot step is a no-op (idempotent), even though the rules are different now.
select is(private.snapshot_order_commission((select id from o1)), 0, 'snapshotting an already snapshotted order inserts nothing');
select is((select count(*) from (select * from public.order_item_commission_snapshots except select * from snap_before) x), 0::bigint,
  'the repeated snapshot did not change any row');

-- The same edits DO move the estimate of an order that was not confirmed yet.
create temp table o4 as select pg_temp.draft_order((select store_id from fx), pg_temp.items_abc(), 0) as id;
grant select on o4 to public;
create temp table e6 as select pg_temp.estimate_as((select store_id from fx), (select id from o4)) as j;
grant select on e6 to public;
select is((select j ->> 'basis' from e6), 'ESTIMATE', 'a new draft is an estimate');
select is((select j ->> 'seller_role_code' from e6), 'SALE_B2B', 'the estimate uses the seller''s current role');
select is(pg_temp.line_nums((select j from e6), 'rate_percent'), array[20, 20, 20]::numeric[], 'the new user rule and the new role rate apply to unconfirmed orders');
select is(pg_temp.line_texts((select j from e6), 'rule_source'), array['USER_PRODUCT', 'ROLE', 'ROLE'], 'the estimate follows the current priority order');
-- 20% of 33333 / 30003 / 6993: remainders tie at .6 on all three lines, so the lowest SKU takes the leftover unit
select is(pg_temp.line_ints((select j from e6), 'base_commission'), array[6667, 6000, 1398]::bigint[], 'ties on the remainder go to the lower SKU');
select is((select (j ->> 'base_commission')::bigint from e6), 14065::bigint, 'order-level base = floor(14065,8)');

-- ---------------------------------------------------------------------------
-- The snapshot is immutable
-- ---------------------------------------------------------------------------
select throws_ok($$update public.order_item_commission_snapshots set rate_percent = 1 where order_id = (select id from o1)$$, 'P0001',
  'Tỷ lệ hoa hồng đã chốt khi đơn được xác nhận lần đầu là bất biến: không được sửa hoặc xóa.', 'a snapshot cannot be updated, even by a privileged role');
select throws_ok($$delete from public.order_item_commission_snapshots where order_id = (select id from o1)$$, 'P0001',
  'Tỷ lệ hoa hồng đã chốt khi đơn được xác nhận lần đầu là bất biến: không được sửa hoặc xóa.', 'a snapshot cannot be deleted');
select throws_ok($$truncate public.order_item_commission_snapshots$$, 'P0001',
  'Tỷ lệ hoa hồng đã chốt khi đơn được xác nhận lần đầu là bất biến: không được sửa hoặc xóa.', 'the snapshot table cannot be truncated');

-- ---------------------------------------------------------------------------
-- No role can prefill a snapshot: only the trigger writes it (service_role bypasses RLS, so the grant matters)
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('service_role', 'public.order_item_commission_snapshots', 'INSERT'), 'service_role has no INSERT grant');
select ok(not has_table_privilege('service_role', 'public.order_item_commission_snapshots', 'UPDATE'), 'service_role has no UPDATE grant');
select ok(not has_table_privilege('service_role', 'public.order_item_commission_snapshots', 'DELETE'), 'service_role has no DELETE grant');
select ok(not has_table_privilege('service_role', 'public.order_item_commission_snapshots', 'TRUNCATE'), 'service_role has no TRUNCATE grant');
select ok(has_table_privilege('service_role', 'public.order_item_commission_snapshots', 'SELECT'), 'service_role can still read');
select ok(not has_table_privilege('authenticated', 'public.order_item_commission_snapshots', 'INSERT'), 'authenticated has no INSERT grant');

create temp table o6 as select pg_temp.draft_order((select sale_id from fx), pg_temp.items_ab(), 0) as id;
grant select on o6 to public;

set local role service_role;
select throws_ok($$insert into public.order_item_commission_snapshots (order_id, order_item_id, product_id, seller_user_id,
    seller_role_id, seller_role_code, quantity, commission_revenue, rate_percent, rule_source, resolved_on, base_commission,
    customer_discount_share)
  select i.order_id, i.id, i.product_id, (select sale_id from fx), (select sale_role_id from fx), 'SALE_B2B', i.quantity,
    i.gross_line_amount, 99, 'NONE', current_date, 1, 0 from public.order_items i where i.order_id = (select id from o6)$$,
  '42501', null, 'the service role cannot prefill a draft order''s snapshot');
reset role;
select is((select count(*) from public.order_item_commission_snapshots where order_id = (select id from o6)), 0::bigint, 'nothing was prefilled');

-- The real first confirmation still writes the real snapshot (the trigger runs as the table owner).
select pg_temp.submit_order((select id from o6), (select sale_id from fx));
select pg_temp.admin_confirm((select id from o6));
select is(pg_temp.snap_nums((select id from o6), 'rate_percent'), array[20, 20]::numeric[], 'the real snapshot holds the resolved rates, not forged ones');
select is(pg_temp.snap_ints((select id from o6), 'base_commission'), array[6667, 6000]::bigint[], 'and the real base commission');

-- ---------------------------------------------------------------------------
-- Owner decision 17/10/2026: a rate cut leaves the discount above the base commission at CONFIRMED.
-- The payment still confirms the order once, the snapshot is written once, and the commission is locked behind an
-- Admin exception (reason + audit) that nothing approves automatically.
--   draft: user+product rules 10% -> base 3333 / 3000 = 6333 (ceiling 6333), discount 6000 is allowed
--   cut to 5% while WAITING_DEPOSIT -> base 1666 / 1500 = 3166 ; discount shares 3158 / 2842 ; excess 6000 - 3166 = 2834
-- ---------------------------------------------------------------------------
update public.app_settings set value = '"PERCENT"'::jsonb where key = 'default_deposit_type';
update public.app_settings set value = '30'::jsonb where key = 'default_deposit_value';

create temp table x_rules as
with ins as (
  insert into public.commission_rules (user_id, product_id, rate_percent, effective_from)
  values ((select sale_id from fx), (select pa from fx), 10, date '2000-01-01'),
         ((select sale_id from fx), (select pb from fx), 10, date '2000-01-01')
  returning id
)
select id from ins;
grant select on x_rules to public;

create temp table ox as select pg_temp.draft_order((select sale_id from fx), pg_temp.items_ab(), 6000) as id;
grant select on ox to public;
select pg_temp.submit_order((select id from ox), (select sale_id from fx));
select pg_temp.admin_confirm((select id from ox));
select is((select status from public.orders where id = (select id from ox)), 'WAITING_DEPOSIT', 'fixture: the Admin''s confirmation only reaches WAITING_DEPOSIT');
select is((select count(*) from public.order_item_commission_snapshots where order_id = (select id from ox)), 0::bigint,
  'nothing is frozen at the Admin click: the snapshot moment is the actual CONFIRMED transition');

update public.commission_rules set rate_percent = 5 where id in (select id from x_rules);
select is(pg_temp.estimate_as((select sale_id from fx), (select id from ox)) ->> 'basis', 'ESTIMATE', 'before the deposit the order is still an estimate');
select is((pg_temp.estimate_as((select sale_id from fx), (select id from ox)) ->> 'company_borne_excess')::bigint, 2834::bigint,
  'the estimate already shows the excess the company would bear');

-- The deposit payment makes the order CONFIRMED (payment-driven transition) and posts exactly once.
create function pg_temp.pay_deposit(p_order uuid) returns bigint language plpgsql as $$
declare
  v_amount bigint;
begin
  perform pg_temp.as_user((select admin_id from fx));
  select deposit_required into v_amount from public.orders where id = p_order;
  perform public.record_payment(p_order, 'CASH', v_amount);
  return v_amount;
end;
$$;
create temp table x_paid as select pg_temp.pay_deposit((select id from ox)) as amount;
grant select on x_paid to public;

select is((select status from public.orders where id = (select id from ox)), 'CONFIRMED', 'the paid deposit confirmed the order although the discount is now above the commission');
select is((select count(*) from public.payments where order_id = (select id from ox)), 1::bigint, 'the payment is posted exactly once');
select is((select paid_amount from public.orders where id = (select id from ox)), (select amount from x_paid), 'and the order shows exactly that amount as paid');
select is((select count(*) from public.order_status_history where order_id = (select id from ox) and to_status = 'CONFIRMED'), 1::bigint, 'the order entered CONFIRMED once');
select is((select count(*) from public.order_item_commission_snapshots where order_id = (select id from ox)), 2::bigint, 'one immutable snapshot row per line');
select is(pg_temp.snap_nums((select id from ox), 'rate_percent'), array[5, 5]::numeric[], 'the rate frozen is the one in force at the actual CONFIRMED transition');
select is(pg_temp.snap_ints((select id from ox), 'base_commission'), array[1666, 1500]::bigint[], 'snapshot base commission after the cut');
select is(pg_temp.snap_ints((select id from ox), 'customer_discount_share'), array[3158, 2842]::bigint[], 'the full customer discount stays attributed per line');
select is(pg_temp.snap_ints((select id from ox), 'commission_deduction'), array[1666, 1500]::bigint[], 'the commission funds only its own base');
select is(pg_temp.snap_ints((select id from ox), 'payable_commission'), array[0, 0]::bigint[], 'payable commission is zero, not negative');
select is((select discount_amount || '/' || net_amount from public.orders where id = (select id from ox)), '6000/57336', 'order discount and net revenue are untouched');
select is((select sum(customer_discount_share)::bigint from snap where order_id = (select id from ox)), 6000::bigint, 'the customer discount attribution (for returns) still sums to the whole discount');

select is((select count(*) from public.commission_discount_exceptions where order_id = (select id from ox)), 1::bigint, 'exactly one exception was raised');
select is((select status from public.commission_discount_exceptions where order_id = (select id from ox)), 'PENDING', 'and it is pending: nothing auto-approves');
select is((select base_commission || '/' || customer_discount || '/' || company_borne_excess
  from public.commission_discount_exceptions where order_id = (select id from ox)), '3166/6000/2834', 'it records base, discount and the company-borne excess');
select is(private.commission_is_locked((select id from ox)), true, 'the commission is locked while the exception is pending');

create temp table ex_before as select * from public.order_item_commission_snapshots where order_id = (select id from ox);
grant select on ex_before to public;

create temp table ex1 as select pg_temp.estimate_as((select sale_id from fx), (select id from ox)) as j;
grant select on ex1 to public;
select is((select j ->> 'basis' from ex1), 'SNAPSHOT', 'the seller sees the frozen snapshot');
select is((select j -> 'commission_locked' from ex1), 'true'::jsonb, 'and that the commission is locked');
select is((select j -> 'exception' ->> 'status' from ex1), 'PENDING', 'with the exception status');
select is((select j -> 'exception' ->> 'approval_reason' from ex1), null, 'the approval reason is not shown to the seller');
select is((select (j ->> 'final_commission')::bigint from ex1), 0::bigint, 'the payable commission is zero');
select is((select (j ->> 'company_borne_excess')::bigint from ex1), 2834::bigint, 'the company-borne excess is explicit');

create function pg_temp.approve_as(p_user uuid, p_order uuid, p_reason text) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return public.approve_commission_discount_exception(p_order, p_reason);
end;
$$;

-- Only the Admin approves, with a written reason.
select pg_temp.as_user((select sale_id from fx));
select throws_ok($$select public.approve_commission_discount_exception((select id from ox), 'Tôi tự duyệt')$$, '42501',
  'Chỉ Admin được duyệt ngoại lệ chiết khấu hoa hồng.', 'the seller cannot approve their own exception');
select pg_temp.as_user((select warehouse_id from fx));
select throws_ok($$select public.approve_commission_discount_exception((select id from ox), 'Kho duyệt')$$, '42501', null, 'Warehouse cannot approve');
select pg_temp.as_user((select admin_id from fx));
select throws_ok($$select public.approve_commission_discount_exception((select id from ox), '   ')$$, '22023',
  'Cần nhập lý do khi duyệt ngoại lệ chiết khấu hoa hồng.', 'a blank reason is refused');
select throws_ok($$select public.approve_commission_discount_exception((select id from ox), null)$$, '22023', null, 'a missing reason is refused');
select throws_ok($$select public.approve_commission_discount_exception((select id from o1), 'Không có ngoại lệ')$$, 'P0002', null,
  'an order without an exception has nothing to approve');
select is((select status from public.commission_discount_exceptions where order_id = (select id from ox)), 'PENDING', 'refused attempts changed nothing');
select is(private.commission_is_locked((select id from ox)), true, 'and the commission is still locked');

-- Approval: audited, and repeating it neither fails nor writes a second audit entry.
create temp table ap1 as select pg_temp.approve_as((select admin_id from fx), (select id from ox), '  Owner đồng ý chiết khấu vượt hoa hồng  ') as j;
grant select on ap1 to public;
select is((select j ->> 'status' from ap1), 'APPROVED', 'the Admin approved the exception');
select is((select (j ->> 'already_approved')::boolean from ap1), false, 'first approval');
select is(private.commission_is_locked((select id from ox)), false, 'the lock is released');
select is((select approval_reason from public.commission_discount_exceptions where order_id = (select id from ox)), 'Owner đồng ý chiết khấu vượt hoa hồng', 'the trimmed reason is stored');
select is((select approved_by::text from public.commission_discount_exceptions where order_id = (select id from ox)), (select admin_id::text from fx), 'with the approving Admin');
select is((select count(*) from public.audit_logs where entity_type = 'commission_discount_exceptions'
  and entity_id = (select id from public.commission_discount_exceptions where order_id = (select id from ox)) and action = 'update'), 1::bigint,
  'the approval is audited once');
select is((select reason from public.audit_logs where entity_type = 'commission_discount_exceptions'
  and entity_id = (select id from public.commission_discount_exceptions where order_id = (select id from ox)) and action = 'update'),
  'Owner đồng ý chiết khấu vượt hoa hồng', 'and the audit entry carries the reason');
select is((select count(*) from public.audit_logs where entity_type = 'commission_discount_exceptions'
  and entity_id = (select id from public.commission_discount_exceptions where order_id = (select id from ox)) and action = 'insert'), 1::bigint,
  'raising the exception was audited too');

create temp table ap2 as select pg_temp.approve_as((select admin_id from fx), (select id from ox), 'Duyệt lại lần hai') as j;
grant select on ap2 to public;
select is((select (j ->> 'already_approved')::boolean from ap2), true, 'approving again is idempotent');
select is((select count(*) from public.audit_logs where entity_type = 'commission_discount_exceptions'
  and entity_id = (select id from public.commission_discount_exceptions where order_id = (select id from ox)) and action = 'update'), 1::bigint,
  'and writes no second audit entry');
select is((select approval_reason from public.commission_discount_exceptions where order_id = (select id from ox)), 'Owner đồng ý chiết khấu vượt hoa hồng',
  'nor does it overwrite the first reason');
select is((select count(*) from (select * from public.order_item_commission_snapshots where order_id = (select id from ox)
  except select * from ex_before) x), 0::bigint, 'the approval never touches the immutable snapshot');
select is(pg_temp.estimate_as((select sale_id from fx), (select id from ox)) -> 'exception' ->> 'status', 'APPROVED', 'the seller sees it approved');
select is((pg_temp.estimate_as((select admin_id from fx), (select id from ox)) -> 'exception' ->> 'approval_reason'), 'Owner đồng ý chiết khấu vượt hoa hồng', 'the Admin sees the reason');
select is((select count(*) from public.payments where order_id = (select id from ox)), 1::bigint, 'the payment was never reposted');

-- The exception record itself is immutable after the decision, and no API role writes it.
select throws_ok($$update public.commission_discount_exceptions set approval_reason = 'sửa' where order_id = (select id from ox)$$, 'P0001',
  'Ngoại lệ chiết khấu hoa hồng chỉ được duyệt một lần, không được sửa hoặc xóa.', 'an approved exception cannot be edited');
select throws_ok($$update public.commission_discount_exceptions set status = 'PENDING' where order_id = (select id from ox)$$, 'P0001', null, 'it cannot be reopened');
select throws_ok($$delete from public.commission_discount_exceptions where order_id = (select id from ox)$$, 'P0001', null, 'it cannot be deleted');
select throws_ok($$truncate public.commission_discount_exceptions$$, 'P0001', null, 'the table cannot be truncated');
select ok(not has_table_privilege('authenticated', 'public.commission_discount_exceptions', 'INSERT'), 'authenticated has no INSERT grant on exceptions');
select ok(not has_table_privilege('authenticated', 'public.commission_discount_exceptions', 'UPDATE'), 'authenticated has no UPDATE grant on exceptions');
select ok(not has_table_privilege('service_role', 'public.commission_discount_exceptions', 'INSERT'), 'service_role has no INSERT grant on exceptions');
select ok(not has_table_privilege('service_role', 'public.commission_discount_exceptions', 'UPDATE'), 'service_role has no UPDATE grant on exceptions');
select ok(not has_table_privilege('anon', 'public.commission_discount_exceptions', 'SELECT'), 'anon cannot read exceptions');
select ok(not has_function_privilege('anon', 'public.approve_commission_discount_exception(uuid, text)', 'EXECUTE'), 'anon cannot call the approval');
select ok(not has_function_privilege('authenticated', 'private.commission_is_locked(uuid)', 'EXECUTE'), 'the lock check is not exposed to clients');

set local role authenticated;
select pg_temp.as_user((select sale_id from fx));
select is((select count(*) from public.commission_discount_exceptions), 0::bigint, 'RLS: a salesperson does not read the exception table (reason is Admin data)');
select throws_ok($$update public.commission_discount_exceptions set status = 'APPROVED'$$, '42501', null, 'RLS: a salesperson cannot write it');
select pg_temp.as_user((select admin_id from fx));
select is((select count(*) from public.commission_discount_exceptions where order_id = (select id from ox)), 1::bigint, 'RLS: the Admin reads it');
select throws_ok($$update public.commission_discount_exceptions set approval_reason = 'x'$$, '42501', null, 'RLS: even the Admin only changes it through the RPC');
reset role;

-- Back to a zero deposit for the remaining scenarios (an Admin confirmation lands on CONFIRMED again).
update public.app_settings set value = '0'::jsonb where key = 'default_deposit_value';

-- ---------------------------------------------------------------------------
-- Existing order behaviour is unchanged
-- ---------------------------------------------------------------------------
select throws_ok($$update public.order_items set quantity = quantity + 1 where order_id = (select id from o1)$$, 'P0001', null,
  'quantities of a confirmed order are still immutable');
select throws_ok($$delete from public.orders where id = (select id from o1)$$, 'P0001', null, 'orders are still never hard-deleted');

-- Cancelling a confirmed order keeps the snapshot (history is not rewritten) and it cannot be re-confirmed.
select pg_temp.as_user((select admin_id from fx));
select lives_ok($$select public.transition_order((select id from o2), 'cancel', 'Khách đổi ý')$$, 'the Admin can cancel a confirmed order');
select is((select status from public.orders where id = (select id from o2)), 'CANCELLED', 'order 2 is CANCELLED');
select is((select count(*) from public.order_item_commission_snapshots where order_id = (select id from o2)), 3::bigint, 'the cancelled order keeps its snapshot');
select is(pg_temp.estimate_as((select admin_id from fx), (select id from o2)) ->> 'basis', 'SNAPSHOT', 'and still reports it');
select throws_ok($$update public.orders set status = 'CONFIRMED' where id = (select id from o2)$$, 'P0001', null,
  'a cancelled order cannot re-enter CONFIRMED');

-- A cancelled draft that was never confirmed has no snapshot and shows an estimate.
select pg_temp.as_user((select store_id from fx));
select lives_ok($$select public.transition_order((select id from o4), 'cancel', 'Không bán nữa')$$, 'a draft can be cancelled');
select is((select count(*) from public.order_item_commission_snapshots where order_id = (select id from o4)), 0::bigint, 'an order that never confirmed has no snapshot');

-- ---------------------------------------------------------------------------
-- Orders confirmed before snapshots existed are not recomputed from today's rules
-- ---------------------------------------------------------------------------
create temp table o5 as select pg_temp.draft_order((select sale_id from fx), pg_temp.items_ab(), 0) as id;
grant select on o5 to public;
select pg_temp.submit_order((select id from o5), (select sale_id from fx));
select pg_temp.admin_confirm((select id from o5));
alter table public.order_item_commission_snapshots disable trigger order_item_commission_snapshots_no_change;
delete from public.order_item_commission_snapshots where order_id = (select id from o5);
alter table public.order_item_commission_snapshots enable trigger order_item_commission_snapshots_no_change;

create temp table e7 as select pg_temp.estimate_as((select sale_id from fx), (select id from o5)) as j;
grant select on e7 to public;
select is((select j ->> 'basis' from e7), 'MISSING_SNAPSHOT', 'a confirmed order without a snapshot is reported as such');
select is((select jsonb_array_length(j -> 'lines') from e7), 0, 'no figures are invented from today''s rules');
select is((select j -> 'base_commission' from e7), 'null'::jsonb, 'no base commission either');

-- ---------------------------------------------------------------------------
-- Legacy (allocation version 1) snapshots are kept as stored: not recomputed, not clamped, not presented as payable
-- ---------------------------------------------------------------------------
insert into public.order_item_commission_snapshots (order_id, order_item_id, product_id, seller_user_id, seller_role_id,
    seller_role_code, quantity, commission_revenue, rate_percent, rule_source, resolved_on, base_commission, customer_discount_share,
    allocation_version)
  select i.order_id, i.id, i.product_id, (select sale_id from fx), (select sale_role_id from fx), 'SALE_B2B', i.quantity,
    i.gross_line_amount, 0, 'NONE', current_date, 0, 497, 1
  from public.order_items i where i.order_id = (select id from o5) limit 1;
create temp table e8 as select pg_temp.estimate_as((select admin_id from fx), (select id from o5)) as j;
grant select on e8 to public;
select is((select j -> 'lines' -> 0 ->> 'allocation_version' from e8), '1', 'a legacy snapshot is labelled version 1');
select is((select j -> 'lines' -> 0 -> 'payable_commission' from e8), 'null'::jsonb, 'its payable figure is not invented');
select is((select j -> 'lines' -> 0 ->> 'final_commission' from e8), '-497', 'the stored legacy difference is reported unchanged');
select is((select j -> 'company_borne_excess' from e8), 'null'::jsonb, 'the company-borne excess is not derived for it either');
select throws_ok($$insert into public.order_item_commission_snapshots (order_id, order_item_id, product_id, seller_user_id, seller_role_id,
    seller_role_code, quantity, commission_revenue, rate_percent, rule_source, resolved_on, base_commission, customer_discount_share,
    allocation_version, commission_deduction)
  select i.order_id, i.id, i.product_id, (select sale_id from fx), (select sale_role_id from fx), 'SALE_B2B', i.quantity,
    i.gross_line_amount, 0, 'NONE', current_date, 10, 0, 2, 11
  from public.order_items i where i.order_id = (select id from o4) limit 1$$, '23514', null,
  'a version 2 row cannot deduct more than its base commission');

select * from finish();
rollback;
