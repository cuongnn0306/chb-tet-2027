-- pgTAP: SEC-003 catalog guard for row level security and client privileges. Run with: npx supabase test db
-- Reads only the system catalogs: no fixture, no data written, nothing to clean up (the transaction is rolled back).
-- It guards the privilege model that every epic builds on. It does NOT replace the per-role behaviour tests of
-- each epic (tests/integration/*) and it is a drift guard, not an approval of the current grants.
begin;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- 1. Row level security is on everywhere
-- ---------------------------------------------------------------------------
select is(
  coalesce((
    select string_agg(c.relname, ', ' order by c.relname collate "C")
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  ), ''),
  '',
  'every table in public has row level security enabled'
);

-- ---------------------------------------------------------------------------
-- 2. Anonymous visitors
-- ---------------------------------------------------------------------------
select is(
  coalesce((
    select string_agg(c.relname, ', ' order by c.relname collate "C")
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
  ), ''),
  '',
  'anon has no privilege on any table or view in public'
);

select is(
  coalesce((
    select string_agg(c.relname, ', ' order by c.relname collate "C")
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'usage,select,update') else false end
  ), ''),
  '',
  'anon has no privilege on any sequence in public'
);

select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon cannot use the private schema');
select ok(not has_schema_privilege('anon', 'public', 'create'), 'anon cannot create objects in public');
select ok(not has_schema_privilege('authenticated', 'public', 'create'), 'signed-in users cannot create objects in public');
select ok(not has_schema_privilege('authenticated', 'private', 'create'), 'signed-in users cannot create objects in private');

-- ---------------------------------------------------------------------------
-- 3. The private schema is not a data surface
-- ---------------------------------------------------------------------------
select is(
  coalesce((
    select string_agg(c.relname, ', ' order by c.relname collate "C")
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
        or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger'))
  ), ''),
  '',
  'no table or view in private is reachable by anon or signed-in users'
);

select is(
  coalesce((
    select string_agg(n.nspname || '.' || c.relname, ', ' order by n.nspname collate "C", c.relname collate "C")
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind = 'S'
      and case when c.relkind = 'S' then has_sequence_privilege('authenticated', c.oid, 'usage,select,update') else false end
  ), ''),
  '',
  'signed-in users have no direct privilege on any sequence (codes come from the server-side RPCs)'
);

-- ---------------------------------------------------------------------------
-- 4. What a signed-in user may write directly
-- ---------------------------------------------------------------------------
select is(
  coalesce((
    select string_agg(c.relname, ', ' order by c.relname collate "C")
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('authenticated', c.oid, 'truncate')
  ), ''),
  '',
  'signed-in users cannot truncate any table in public'
);

select is(
  coalesce((
    select string_agg(c.relname, ', ' order by c.relname collate "C")
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('authenticated', c.oid, 'delete')
  ), ''),
  '',
  'signed-in users cannot delete rows from any table in public (nothing is hard-deleted)'
);

-- Orders, items, payments, payment events, inventory ledger/balances/reservations, deliveries, transfers and the
-- audit log are written only by SECURITY DEFINER RPCs/triggers. A new table that grants direct client writes must
-- be reviewed on purpose: add it to this list in the same change.
select is(
  coalesce((
    select string_agg(c.relname, ', ' order by c.relname collate "C")
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('authenticated', c.oid, 'insert,update')
  ), ''),
  'app_settings, commission_rules, customers, lead_sources, locations, product_batches, products, profiles, roles, safety_stock_rules, sales_channels',
  'only the master-data tables accept direct client writes; every workflow and ledger table is RPC-only'
);

-- ---------------------------------------------------------------------------
-- 5. Policies
-- ---------------------------------------------------------------------------
select is(
  coalesce((
    select string_agg(tablename || '.' || policyname, ', ' order by tablename collate "C", policyname collate "C")
    from pg_policies
    where schemaname = 'public' and roles && array['public', 'anon']::name[]
  ), ''),
  '',
  'no policy in public applies to anon or to every role'
);

select is(
  coalesce((
    select string_agg(tablename || '.' || policyname, ', ' order by tablename collate "C", policyname collate "C")
    from pg_policies
    where schemaname = 'public' and cmd <> 'SELECT'
      and (btrim(coalesce(qual, '')) = 'true' or btrim(coalesce(with_check, '')) = 'true')
  ), ''),
  '',
  'no write policy in public allows everything unconditionally'
);

select is(
  coalesce((
    select string_agg(c.relname, ', ' order by c.relname collate "C")
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not exists (
        select 1 from unnest(coalesce(c.reloptions, '{}'::text[])) o where o in ('security_invoker=true', 'security_invoker=on')
      )
  ), ''),
  '',
  'every view in public runs with the privileges of the caller (security_invoker)'
);

-- ---------------------------------------------------------------------------
-- 6. SECURITY DEFINER functions
-- ---------------------------------------------------------------------------
select is(
  coalesce((
    select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname collate "C", p.proname collate "C")
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg = 'search_path=""')
  ), ''),
  '',
  'every SECURITY DEFINER function in public/private sets an empty search_path'
);

select is(
  coalesce((
    select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname collate "C", p.proname collate "C")
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
  ), ''),
  '',
  'anon can execute no SECURITY DEFINER function'
);

-- The server-only entry points: webhook, auth sync, stock posting, payment closing and audit. A rename must update
-- this test. Count distinct schema/name pairs so an extra overload cannot mask a missing entry point.
select is(
  (select count(distinct (n.nspname, p.proname))::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname, p.proname) in (
     ('public', 'process_sepay_webhook'), ('public', 'handle_new_auth_user'),
     ('private', 'process_sepay_event'), ('private', 'post_inventory_movement'), ('private', 'close_payment'),
     ('private', 'consume_order_item_stock'), ('private', 'bind_delivery_item_batches'),
     ('private', 'allocate_due_deliveries'), ('private', 'audit_row_change'))),
  9,
  'the nine server-only functions named by this test exist'
);

select is(
  coalesce((
    select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname collate "C", p.proname collate "C")
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
      ('public', 'process_sepay_webhook'), ('public', 'handle_new_auth_user'),
      ('private', 'process_sepay_event'), ('private', 'post_inventory_movement'), ('private', 'close_payment'),
      ('private', 'consume_order_item_stock'), ('private', 'bind_delivery_item_batches'),
      ('private', 'allocate_due_deliveries'), ('private', 'audit_row_change'))
      and has_function_privilege('authenticated', p.oid, 'execute')
  ), ''),
  '',
  'signed-in users cannot execute the server-only functions'
);

select * from finish();
rollback;
