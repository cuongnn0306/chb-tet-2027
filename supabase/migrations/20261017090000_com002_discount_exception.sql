-- COM-002, Owner decision 17/10/2026 (docs/product/OWNER_DECISIONS_2026-10-17.md).
-- Builds on 20261016090000_com002_commission_snapshot.sql, which is left untouched.
--
--   1. Every line's payable commission is nonnegative. The customer discount (attributed per line, unchanged)
--      is split from the commission deduction (what the employee's commission funds, 0 <= deduction <= base):
--        discount = sum(commission_deduction) + company-borne excess,  payable = base - deduction.
--   2. If the discount exceeds the base commission at the first CONFIRMED (a rate cut after drafting), the order
--      still confirms and the payment stays posted once. A PENDING exception row locks the commission until an
--      Admin approves it with a written reason (audited). Nothing is auto-approved.
--   3. Snapshots stay immutable. Rows written by the previous allocation keep allocation_version = 1 and are not
--      rewritten; rows written from now on are version 2.

-- ---------------------------------------------------------------------------
-- Snapshot columns for the bounded allocation (additive; version 1 rows keep NULLs)
-- ---------------------------------------------------------------------------
alter table public.order_item_commission_snapshots
  add column allocation_version smallint not null default 1,
  add column commission_deduction bigint;

alter table public.order_item_commission_snapshots
  add column payable_commission bigint generated always as (base_commission - commission_deduction) stored;

alter table public.order_item_commission_snapshots
  add constraint order_item_commission_snapshots_allocation check (
    (allocation_version = 1 and commission_deduction is null)
    or (allocation_version = 2 and commission_deduction is not null
        and commission_deduction >= 0 and commission_deduction <= base_commission)
  );

comment on column public.order_item_commission_snapshots.final_commission is
  'Legacy difference base - customer_discount_share. It can be negative and is NOT payable; use payable_commission (allocation_version 2).';
comment on column public.order_item_commission_snapshots.commission_deduction is
  'Part of the customer discount funded by this line''s commission (0..base). NULL for allocation_version 1.';

-- ---------------------------------------------------------------------------
-- The Admin exception when the discount exceeds the base commission at CONFIRMED
-- ---------------------------------------------------------------------------
create table public.commission_discount_exceptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED')),
  base_commission bigint not null check (base_commission >= 0),
  customer_discount bigint not null check (customer_discount >= 0),
  company_borne_excess bigint not null check (company_borne_excess > 0),
  created_at timestamptz not null default now(),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  approval_reason text,
  constraint commission_discount_exceptions_order_key unique (order_id),
  constraint commission_discount_exceptions_excess check (company_borne_excess = customer_discount - base_commission),
  constraint commission_discount_exceptions_approval check (
    (status = 'PENDING' and approved_by is null and approved_at is null and approval_reason is null)
    or (status = 'APPROVED' and approved_by is not null and approved_at is not null
        and length(btrim(approval_reason)) > 0)
  )
);

create or replace function private.commission_exception_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The only legal change: PENDING -> APPROVED, with every figure of the exception left as it was.
  if tg_op = 'UPDATE' then
    if old.status = 'PENDING' and new.status = 'APPROVED'
       and (new.id, new.order_id, new.base_commission, new.customer_discount, new.company_borne_excess, new.created_at)
           is not distinct from
           (old.id, old.order_id, old.base_commission, old.customer_discount, old.company_borne_excess, old.created_at) then
      return new;
    end if;
  end if;
  raise exception 'Ngoại lệ chiết khấu hoa hồng chỉ được duyệt một lần, không được sửa hoặc xóa.';
end;
$$;

create trigger commission_discount_exceptions_guard
  before update or delete on public.commission_discount_exceptions
  for each row execute function private.commission_exception_guard();
create trigger commission_discount_exceptions_no_truncate
  before truncate on public.commission_discount_exceptions
  for each statement execute function private.commission_exception_guard();

create trigger audit_commission_discount_exceptions
  after insert or update on public.commission_discount_exceptions
  for each row execute function private.audit_row_change();

alter table public.commission_discount_exceptions enable row level security;
revoke all on table public.commission_discount_exceptions from anon;
revoke insert, update, delete, truncate on table public.commission_discount_exceptions from authenticated, service_role;

-- The table carries the approval reason: Admin only. A salesperson sees only the status through the estimate RPC.
create policy commission_discount_exceptions_select_admin on public.commission_discount_exceptions
  for select to authenticated
  using ((select private.is_admin()));

revoke all on function private.commission_exception_guard() from public, anon, authenticated;

-- True while an exception is waiting for the Admin: COM-003 must not make the commission eligible then.
create or replace function private.commission_is_locked(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.commission_discount_exceptions e where e.order_id = p_order_id and e.status = 'PENDING'
  )
$$;
revoke all on function private.commission_is_locked(uuid) from public, anon, authenticated;
grant execute on function private.commission_is_locked(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Per-line basis with the bounded deduction (same base and discount rounding as before)
-- ---------------------------------------------------------------------------
drop function private.order_commission_basis(uuid, date);

create function private.order_commission_basis(p_order_id uuid, p_on date)
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
  customer_discount_share bigint,
  commission_deduction bigint
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
  ),
  alloc as (
    select r.order_item_id, r.product_id, r.sku, r.quantity, r.commission_revenue,
           r.rate_percent, r.rule_source, r.rule_id, r.rule_effective_from, r.rule_effective_to,
           r.base_floor + case when r.base_rank <= r.base_target - sum(r.base_floor) over () then 1 else 0 end
             as base_commission,
           r.discount_floor + case when r.discount_rank <= o.discount_amount - sum(r.discount_floor) over () then 1 else 0 end
             as customer_discount_share
    from ranked r cross join o
  ),
  -- Step 1 of the deduction: the line's own share of the discount, capped by its base commission.
  capped as (
    select a.*,
           least(a.customer_discount_share, a.base_commission) as own_deduction,
           a.base_commission - least(a.customer_discount_share, a.base_commission) as room
    from alloc a
  ),
  -- Step 2: the funded total is min(discount, base total); what is left after step 1 is spread over the rooms.
  fund as (
    select least(o.discount_amount, sum(c.base_commission)) - sum(c.own_deduction) as remaining,
           sum(c.room) as room_total
    from capped c cross join o
    group by o.discount_amount
  ),
  spread as (
    select c.*, f.remaining, f.room_total,
           case when f.room_total = 0 then 0 else div(f.remaining * c.room, f.room_total) end as extra_floor,
           row_number() over (
             order by case when f.room_total = 0 then 0 else mod(f.remaining * c.room, f.room_total) end desc,
                      c.sku collate "C", c.order_item_id) as extra_rank
    from capped c cross join fund f
  )
  select s.order_item_id, s.product_id, s.sku, s.quantity, s.commission_revenue,
         s.rate_percent, s.rule_source, s.rule_id, s.rule_effective_from, s.rule_effective_to,
         s.base_commission, s.customer_discount_share,
         (s.own_deduction + s.extra_floor
           + case when s.extra_rank <= s.remaining - sum(s.extra_floor) over () then 1 else 0 end)::bigint
  from spread s
  order by s.sku collate "C", s.order_item_id
$$;

revoke all on function private.order_commission_basis(uuid, date) from public, anon, authenticated;
grant execute on function private.order_commission_basis(uuid, date) to service_role;

-- ---------------------------------------------------------------------------
-- Snapshot at the first CONFIRMED: version 2 rows, plus the pending exception when the discount is above the base
-- ---------------------------------------------------------------------------
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
    rule_effective_to, resolved_on, base_commission, customer_discount_share, snapshot_by,
    allocation_version, commission_deduction
  )
  select
    o.id, b.order_item_id, b.product_id, o.owner_user_id, p.role_id, ro.code,
    b.quantity, b.commission_revenue, b.rate_percent, b.rule_source, b.rule_id, b.rule_effective_from,
    b.rule_effective_to, v_on, b.base_commission, b.customer_discount_share, (select auth.uid()),
    2, b.commission_deduction
  from public.orders o
  join public.profiles p on p.id = o.owner_user_id
  join public.roles ro on ro.id = p.role_id
  cross join lateral private.order_commission_basis(o.id, v_on) b
  where o.id = p_order_id
  on conflict (order_item_id) do nothing;
  get diagnostics v_rows = row_count;

  -- A discount above the base commission never blocks the confirmation or the payment that caused it: the order
  -- confirms, and the commission stays locked behind a PENDING exception for the Admin to decide.
  if v_rows > 0 then
    insert into public.commission_discount_exceptions (order_id, base_commission, customer_discount, company_borne_excess)
    select s.order_id, sum(s.base_commission), o.discount_amount, o.discount_amount - sum(s.base_commission)
    from public.order_item_commission_snapshots s
    join public.orders o on o.id = s.order_id
    where s.order_id = p_order_id
    group by s.order_id, o.discount_amount
    having o.discount_amount > sum(s.base_commission)
    on conflict (order_id) do nothing;
  end if;
  return v_rows;
end;
$$;
revoke all on function private.snapshot_order_commission(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin approval of the exception: reason required, audited, idempotent and race-safe
-- ---------------------------------------------------------------------------
create or replace function public.approve_commission_discount_exception(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ex public.commission_discount_exceptions;
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Chỉ Admin được duyệt ngoại lệ chiết khấu hoa hồng.' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'Cần nhập lý do khi duyệt ngoại lệ chiết khấu hoa hồng.' using errcode = '22023';
  end if;

  -- The row lock serialises concurrent approvals: the second caller waits, then sees APPROVED and changes nothing.
  select * into v_ex from public.commission_discount_exceptions where order_id = p_order_id for update;
  if not found then
    raise exception 'Đơn này không có ngoại lệ chiết khấu hoa hồng cần duyệt.' using errcode = 'P0002';
  end if;

  if v_ex.status = 'APPROVED' then
    return jsonb_build_object('order_id', v_ex.order_id, 'status', v_ex.status, 'already_approved', true,
      'approved_at', v_ex.approved_at);
  end if;

  perform set_config('app.audit_reason', v_reason, true);
  update public.commission_discount_exceptions
     set status = 'APPROVED', approved_by = (select auth.uid()), approved_at = now(), approval_reason = v_reason
   where id = v_ex.id
  returning * into v_ex;

  return jsonb_build_object('order_id', v_ex.order_id, 'status', v_ex.status, 'already_approved', false,
    'approved_at', v_ex.approved_at);
end;
$$;
revoke all on function public.approve_commission_discount_exception(uuid, text) from public, anon;
grant execute on function public.approve_commission_discount_exception(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- estimate_order_commission: payable (nonnegative), funded discount, company-borne excess, exception state
--   final_commission is the employee's payable commission (sum of payable lines).
--   allocation_version 1 snapshots keep their stored figures; their payable/excess fields are NULL (not recomputed).
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
  v_funded bigint;
  v_payable bigint;
  v_legacy boolean := false;
  v_ex public.commission_discount_exceptions;
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
             'commission_deduction', s.commission_deduction,
             'payable_commission', s.payable_commission,
             'final_commission', coalesce(s.payable_commission, s.final_commission),
             'allocation_version', s.allocation_version) order by pr.sku collate "C", s.order_item_id),
           coalesce(sum(s.base_commission), 0),
           sum(s.commission_deduction),
           coalesce(sum(coalesce(s.payable_commission, s.final_commission)), 0),
           coalesce(bool_or(s.allocation_version = 1), false)
      into v_lines, v_base, v_funded, v_payable, v_legacy
    from public.order_item_commission_snapshots s
    join public.products pr on pr.id = s.product_id
    where s.order_id = p_order_id;

    select * into v_ex from public.commission_discount_exceptions where order_id = p_order_id;

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
             'commission_deduction', b.commission_deduction,
             'payable_commission', b.base_commission - b.commission_deduction,
             'final_commission', b.base_commission - b.commission_deduction,
             'allocation_version', 2) order by b.sku collate "C", b.order_item_id),
           coalesce(sum(b.base_commission), 0),
           coalesce(sum(b.commission_deduction), 0),
           coalesce(sum(b.base_commission - b.commission_deduction), 0)
      into v_lines, v_base, v_funded, v_payable
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
    'commission_funded_discount', v_funded,
    'company_borne_excess', case when v_base is null or v_legacy then null else v_order.discount_amount - v_funded end,
    'final_commission', case when v_base is null then null else v_payable end,
    -- A rate cut after the draft was saved can leave the discount above the base commission.
    'discount_within_base_commission', v_order.discount_amount <= v_base,
    -- The Admin exception that locks the commission (SNAPSHOT only). The reason is Admin-only.
    'exception', case when v_ex.id is null then null else jsonb_build_object(
      'status', v_ex.status,
      'company_borne_excess', v_ex.company_borne_excess,
      'approved_at', v_ex.approved_at,
      'approval_reason', case when v_admin then v_ex.approval_reason end) end,
    'commission_locked', coalesce(v_ex.status = 'PENDING', false),
    'lines', coalesce(v_lines, '[]'::jsonb)
  );
end;
$$;
