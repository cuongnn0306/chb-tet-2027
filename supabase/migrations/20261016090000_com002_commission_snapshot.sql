-- COM-002: estimated commission and the first-confirmation per-item snapshot.
-- (PRD §19.1-19.4, TECH_DESIGN §12 "Commission state machine".)
--
-- Behaviour:
--   * Before an order is first CONFIRMED, commission is an ESTIMATE computed on demand from the rules
--     effective today (Vietnam business date). It is never stored and changes whenever rules/roles change.
--   * At the FIRST transition into CONFIRMED an AFTER trigger snapshots, for every order line, the resolved
--     rate, the rule evidence (source/id/period), the seller and the seller's role. The snapshot is immutable:
--     later rule or role edits never rewrite it, and no history is recomputed from today's rules.
--   * Money is integer VND. commission revenue = list price x quantity (gross_line_amount, PRD §19.1).
--     Base commission and the order-level customer discount are split across lines with the largest-remainder
--     method so that sum(line base) = floor(sum(gross x rate / 100)) (the same figure as the discount ceiling,
--     ORD-005) and sum(line discount share) = the order discount. Ties go to the lower SKU, then item id.
--   * Not in scope here: eligibility (COM-003), return adjustments (COM-005), campaign finalization (COM-008).

-- ---------------------------------------------------------------------------
-- Rate resolution that also returns its evidence (COM-001 priority, unchanged):
--   1 User+Product, 2 User, 3 Role+Product, 4 Role, 5 product default (NONE if the product is unknown).
-- Same-priority tie-break: latest effective_from, then latest created_at.
-- ---------------------------------------------------------------------------
create or replace function private.resolve_commission_rule(p_user_id uuid, p_product_id uuid, p_on date)
returns table (
  rate_percent numeric,
  rule_source text,
  rule_id uuid,
  rule_effective_from date,
  rule_effective_to date
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id as user_id, p.role_id from public.profiles p where p.id = p_user_id
  ),
  candidates as (
    select 1 as prio, 'USER_PRODUCT' as src, r.id, r.rate_percent, r.effective_from, r.effective_to, r.created_at
    from public.commission_rules r, me
    where r.is_active and r.user_id = me.user_id and r.product_id = p_product_id
      and r.effective_from <= p_on and (r.effective_to is null or r.effective_to >= p_on)
    union all
    select 2, 'USER', r.id, r.rate_percent, r.effective_from, r.effective_to, r.created_at
    from public.commission_rules r, me
    where r.is_active and r.user_id = me.user_id and r.product_id is null
      and r.effective_from <= p_on and (r.effective_to is null or r.effective_to >= p_on)
    union all
    select 3, 'ROLE_PRODUCT', r.id, r.rate_percent, r.effective_from, r.effective_to, r.created_at
    from public.commission_rules r, me
    where r.is_active and r.role_id = me.role_id and r.product_id = p_product_id
      and r.effective_from <= p_on and (r.effective_to is null or r.effective_to >= p_on)
    union all
    select 4, 'ROLE', r.id, r.rate_percent, r.effective_from, r.effective_to, r.created_at
    from public.commission_rules r, me
    where r.is_active and r.role_id = me.role_id and r.product_id is null
      and r.effective_from <= p_on and (r.effective_to is null or r.effective_to >= p_on)
  ),
  picked as (
    select c.src, c.id, c.rate_percent, c.effective_from, c.effective_to
    from candidates c
    order by c.prio, c.effective_from desc, c.created_at desc
    limit 1
  )
  select pk.rate_percent, pk.src, pk.id, pk.effective_from, pk.effective_to from picked pk
  union all
  select pr.default_commission_rate, 'PRODUCT_DEFAULT', null::uuid, null::date, null::date
  from public.products pr
  where pr.id = p_product_id and not exists (select 1 from picked)
  union all
  select 0::numeric, 'NONE', null::uuid, null::date, null::date
  where not exists (select 1 from picked)
    and not exists (select 1 from public.products pr where pr.id = p_product_id)
$$;

-- The numeric-only resolver (used by pricing, the discount ceiling and submit) now delegates, so there is a
-- single implementation of the priority rules.
create or replace function private.resolve_commission_rate(p_user_id uuid, p_product_id uuid, p_on date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select r.rate_percent from private.resolve_commission_rule(p_user_id, p_product_id, p_on) r
$$;

-- ---------------------------------------------------------------------------
-- Per-line commission basis of an order at a given date. Used both for the live estimate and for the snapshot,
-- so the two can never disagree about rounding.
-- ---------------------------------------------------------------------------
create or replace function private.order_commission_basis(p_order_id uuid, p_on date)
returns table (
  order_item_id uuid,
  product_id uuid,
  sku text,
  quantity int,
  commission_revenue bigint,
  rate_percent numeric,
  rule_source text,
  rule_id uuid,
  rule_effective_from date,
  rule_effective_to date,
  base_commission bigint,
  customer_discount_share bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select id, owner_user_id, discount_amount from public.orders where id = p_order_id
  ),
  lines as (
    select i.id as order_item_id, i.product_id, pr.sku, i.quantity,
           i.gross_line_amount as commission_revenue,
           res.rate_percent, res.rule_source, res.rule_id, res.rule_effective_from, res.rule_effective_to,
           -- exact base commission x 10000 (rate has two decimals): kept integral, no floating point
           i.gross_line_amount::numeric * (res.rate_percent * 100) as base_weight,
           o.discount_amount::numeric * i.gross_line_amount as discount_weight
    from o
    join public.order_items i on i.order_id = o.id
    join public.products pr on pr.id = i.product_id
    cross join lateral private.resolve_commission_rule(o.owner_user_id, i.product_id, p_on) res
  ),
  totals as (
    select sum(commission_revenue) as gross_total,
           floor(sum(base_weight) / 10000)::bigint as base_target
    from lines
  ),
  ranked as (
    select l.*, t.gross_total, t.base_target,
           div(l.base_weight, 10000)::bigint as base_floor,
           row_number() over (order by mod(l.base_weight, 10000) desc, l.sku collate "C", l.order_item_id) as base_rank,
           case when t.gross_total = 0 then 0 else div(l.discount_weight, t.gross_total)::bigint end as discount_floor,
           row_number() over (
             order by case when t.gross_total = 0 then 0 else mod(l.discount_weight, t.gross_total) end desc,
                      l.sku collate "C", l.order_item_id) as discount_rank
    from lines l cross join totals t
  )
  select r.order_item_id, r.product_id, r.sku, r.quantity, r.commission_revenue,
         r.rate_percent, r.rule_source, r.rule_id, r.rule_effective_from, r.rule_effective_to,
         r.base_floor + case when r.base_rank <= r.base_target - sum(r.base_floor) over () then 1 else 0 end,
         r.discount_floor + case when r.discount_rank <= o.discount_amount - sum(r.discount_floor) over () then 1 else 0 end
  from ranked r cross join o
  order by r.sku collate "C", r.order_item_id
$$;

revoke all on function private.resolve_commission_rule(uuid, uuid, date),
  private.order_commission_basis(uuid, date) from public, anon, authenticated;
grant execute on function private.resolve_commission_rule(uuid, uuid, date),
  private.order_commission_basis(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- The snapshot (one row per order line). Written only by the trigger below; immutable.
-- ---------------------------------------------------------------------------
create table public.order_item_commission_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  order_item_id uuid not null references public.order_items (id),
  product_id uuid not null references public.products (id),
  -- Seller basis at the moment of confirmation (not read from the live profile afterwards).
  seller_user_id uuid not null references public.profiles (id),
  seller_role_id uuid not null references public.roles (id),
  seller_role_code text not null,
  quantity int not null check (quantity > 0),
  commission_revenue bigint not null check (commission_revenue >= 0),
  rate_percent numeric(5, 2) not null check (rate_percent >= 0 and rate_percent <= 100),
  -- Rule evidence. rule_id is NULL exactly when no commission_rules row applied.
  rule_source text not null check (rule_source in
    ('USER_PRODUCT', 'USER', 'ROLE_PRODUCT', 'ROLE', 'PRODUCT_DEFAULT', 'NONE')),
  rule_id uuid references public.commission_rules (id),
  rule_effective_from date,
  rule_effective_to date,
  resolved_on date not null,
  base_commission bigint not null check (base_commission >= 0),
  customer_discount_share bigint not null check (customer_discount_share >= 0),
  final_commission bigint generated always as (base_commission - customer_discount_share) stored,
  snapshot_by uuid references public.profiles (id),
  snapshot_at timestamptz not null default now(),
  constraint order_item_commission_snapshots_item_key unique (order_item_id),
  constraint order_item_commission_snapshots_rule_evidence check (
    (rule_source in ('PRODUCT_DEFAULT', 'NONE')) = (rule_id is null)
  )
);

create index order_item_commission_snapshots_order_idx on public.order_item_commission_snapshots (order_id);
create index order_item_commission_snapshots_seller_idx on public.order_item_commission_snapshots (seller_user_id);

create or replace function private.commission_snapshot_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Tỷ lệ hoa hồng đã chốt khi đơn được xác nhận lần đầu là bất biến: không được sửa hoặc xóa.';
end;
$$;

create trigger order_item_commission_snapshots_no_change
  before update or delete on public.order_item_commission_snapshots
  for each row execute function private.commission_snapshot_immutable();
create trigger order_item_commission_snapshots_no_truncate
  before truncate on public.order_item_commission_snapshots
  for each statement execute function private.commission_snapshot_immutable();

-- Access: read-only for clients, and the table itself is Admin-only because it carries rule evidence (rule id and
-- period), which is Admin data like commission_rules. A salesperson reads their own figures through
-- estimate_order_commission, which checks ownership and leaves the evidence out.
alter table public.order_item_commission_snapshots enable row level security;
revoke all on table public.order_item_commission_snapshots from anon;
revoke insert, update, delete, truncate on table public.order_item_commission_snapshots from authenticated;
-- service_role bypasses RLS, so only the grant keeps it from prefilling a draft's snapshot (the first-confirmation
-- insert is ON CONFLICT DO NOTHING and would keep forged values). The only writer is the SECURITY DEFINER trigger
-- function, which runs as the table owner and needs no grant.
revoke insert, update, delete, truncate on table public.order_item_commission_snapshots from service_role;

create policy order_item_commission_snapshots_select_admin on public.order_item_commission_snapshots
  for select to authenticated
  using ((select private.is_admin()));

create trigger audit_order_item_commission_snapshots after insert on public.order_item_commission_snapshots
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- First entry into CONFIRMED -> snapshot, atomically in the same transaction as the status change.
-- ON CONFLICT DO NOTHING keeps this idempotent: a line is snapshotted once and never rewritten.
-- ---------------------------------------------------------------------------
-- Returns how many lines were newly snapshotted (0 when the order already has its snapshot).
create or replace function private.snapshot_order_commission(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on date := private.business_today();
  v_rows int;
begin
  insert into public.order_item_commission_snapshots (
    order_id, order_item_id, product_id, seller_user_id, seller_role_id, seller_role_code,
    quantity, commission_revenue, rate_percent, rule_source, rule_id, rule_effective_from,
    rule_effective_to, resolved_on, base_commission, customer_discount_share, snapshot_by
  )
  select
    o.id, b.order_item_id, b.product_id, o.owner_user_id, p.role_id, ro.code,
    b.quantity, b.commission_revenue, b.rate_percent, b.rule_source, b.rule_id, b.rule_effective_from,
    b.rule_effective_to, v_on, b.base_commission, b.customer_discount_share, (select auth.uid())
  from public.orders o
  join public.profiles p on p.id = o.owner_user_id
  join public.roles ro on ro.id = p.role_id
  cross join lateral private.order_commission_basis(o.id, v_on) b
  where o.id = p_order_id
  on conflict (order_item_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function private.snapshot_order_commission_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.snapshot_order_commission(new.id);
  return null;
end;
$$;

revoke all on function private.commission_snapshot_immutable(), private.snapshot_order_commission(uuid),
  private.snapshot_order_commission_trigger() from public, anon, authenticated;

create trigger orders_snapshot_commission
  after update of status on public.orders
  for each row
  when (new.status = 'CONFIRMED' and old.status is distinct from 'CONFIRMED')
  execute function private.snapshot_order_commission_trigger();

-- ---------------------------------------------------------------------------
-- estimate_order_commission: what the UI shows for one order.
--   basis SNAPSHOT          the order was confirmed: figures come from the immutable snapshot.
--   basis ESTIMATE          never confirmed: computed now from the rules effective today. Subject to change.
--   basis MISSING_SNAPSHOT  confirmed before COM-002 existed: no snapshot and history is NOT recomputed from
--                           today's rules, so no figures are returned.
-- Allowed: Admin, or the order's salesperson (owner). Rule ids/periods are Admin-only evidence.
-- ---------------------------------------------------------------------------
create or replace function public.estimate_order_commission(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean := private.is_admin();
  v_order public.orders;
  v_basis text;
  v_on date;
  v_seller_role text;
  v_lines jsonb;
  v_base bigint;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found
     or not coalesce(v_admin or (private.can_create_orders() and v_order.owner_user_id = v_uid), false) then
    raise exception 'Không tìm thấy đơn hàng hoặc bạn không có quyền xem hoa hồng của đơn này.'
      using errcode = '42501';
  end if;

  if exists (select 1 from public.order_item_commission_snapshots where order_id = p_order_id) then
    v_basis := 'SNAPSHOT';
    select s.resolved_on, s.seller_role_code into v_on, v_seller_role
    from public.order_item_commission_snapshots s where s.order_id = p_order_id limit 1;

    select jsonb_agg(jsonb_build_object(
             'order_item_id', s.order_item_id, 'product_id', s.product_id, 'sku', pr.sku,
             'quantity', s.quantity, 'commission_revenue', s.commission_revenue,
             'rate_percent', s.rate_percent, 'rule_source', s.rule_source,
             'rule_id', case when v_admin then s.rule_id end,
             'rule_effective_from', case when v_admin then s.rule_effective_from end,
             'rule_effective_to', case when v_admin then s.rule_effective_to end,
             'base_commission', s.base_commission,
             'customer_discount_share', s.customer_discount_share,
             'final_commission', s.final_commission) order by pr.sku collate "C", s.order_item_id),
           coalesce(sum(s.base_commission), 0)
      into v_lines, v_base
    from public.order_item_commission_snapshots s
    join public.products pr on pr.id = s.product_id
    where s.order_id = p_order_id;

  elsif exists (select 1 from public.order_status_history h
                where h.order_id = p_order_id and h.to_status = 'CONFIRMED') then
    v_basis := 'MISSING_SNAPSHOT';
    v_lines := '[]'::jsonb;
    v_base := null;

  else
    v_basis := 'ESTIMATE';
    v_on := private.business_today();
    select ro.code into v_seller_role
    from public.profiles p join public.roles ro on ro.id = p.role_id where p.id = v_order.owner_user_id;

    select jsonb_agg(jsonb_build_object(
             'order_item_id', b.order_item_id, 'product_id', b.product_id, 'sku', b.sku,
             'quantity', b.quantity, 'commission_revenue', b.commission_revenue,
             'rate_percent', b.rate_percent, 'rule_source', b.rule_source,
             'rule_id', case when v_admin then b.rule_id end,
             'rule_effective_from', case when v_admin then b.rule_effective_from end,
             'rule_effective_to', case when v_admin then b.rule_effective_to end,
             'base_commission', b.base_commission,
             'customer_discount_share', b.customer_discount_share,
             'final_commission', b.base_commission - b.customer_discount_share) order by b.sku collate "C", b.order_item_id),
           coalesce(sum(b.base_commission), 0)
      into v_lines, v_base
    from private.order_commission_basis(p_order_id, v_on) b;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id,
    'basis', v_basis,
    'is_final', v_basis = 'SNAPSHOT',
    'resolved_on', v_on,
    'seller_user_id', v_order.owner_user_id,
    'seller_role_code', v_seller_role,
    'gross_amount', v_order.gross_amount,
    'discount_amount', v_order.discount_amount,
    'base_commission', v_base,
    'final_commission', v_base - v_order.discount_amount,
    -- A rate cut after the draft was saved can leave the discount above the base commission.
    'discount_within_base_commission', v_order.discount_amount <= v_base,
    'lines', coalesce(v_lines, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.estimate_order_commission(uuid) from public, anon;
grant execute on function public.estimate_order_commission(uuid) to authenticated;
