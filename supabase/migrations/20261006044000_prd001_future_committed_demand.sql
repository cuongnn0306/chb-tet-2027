-- PRD-001: future committed demand by SKU and needed date (PRD_UIUX §15, TECH_DESIGN §6.4).
--
-- Additive read model. public.committed_demand() is NOT changed and stays the single definition of
-- "what is committed": CONFIRMED orders, quantity - allocated_quantity per order line, never RESERVED,
-- never a physically allocated unit. This function only splits that SAME quantity over needed dates, so
-- for every product  sum(future_committed_demand.committed_qty) = committed_demand().committed_qty.
--
-- Needed date = deliveries.scheduled_date of the line's active (not CANCELLED) deliveries, the same set the
-- over-assignment guard counts (delivery_items_guard). A multi-delivery line is therefore split over the
-- delivery dates once, never counted per delivery twice.
--
-- Which date a physically allocated unit belongs to is allocation policy (DEL-005 attributes units per
-- delivery AND per location with a waterfall) and is not an approved rule for demand. So the date is derived
-- only where it is determinate; everything else is reported explicitly, never dropped and never guessed:
--
--   DELIVERY_DATE     the line has no allocated unit: every active delivery quantity is uncovered at its own
--                     date; or the line is fully scheduled on ONE date: the whole uncovered remainder is at it.
--   UNSCHEDULED       part of the uncovered quantity has no delivery at all (no delivery, or quantity not yet
--                     assigned to a delivery): no needed date exists.
--   DATE_UNDETERMINED the line is partly allocated and its uncovered remainder could belong to more than one
--                     delivery date (or to the unscheduled part). needed_date is NULL; the candidate range is
--                     shown. Resolving it needs an approved attribution rule (see the PRD-001 ExecPlan).
--
-- Same authorization as committed_demand(): Admin, Warehouse, Production.

create or replace function public.future_committed_demand()
returns table (
  product_id uuid,
  needed_date date,
  date_basis text,
  order_count int,
  committed_qty bigint,
  earliest_candidate_date date,
  latest_candidate_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['ADMIN', 'WAREHOUSE', 'PRODUCTION']) then
    raise exception 'Bạn không có quyền xem nhu cầu cam kết.' using errcode = '42501';
  end if;

  return query
  with lines as (
    select i.id as item_id, i.order_id, i.product_id, i.quantity,
           i.allocated_quantity, (i.quantity - i.allocated_quantity) as remaining
    from public.order_items i
    join public.orders o on o.id = i.order_id
    where o.status = 'CONFIRMED' and i.quantity > i.allocated_quantity
  ),
  by_date as (
    select di.order_item_id as item_id, d.scheduled_date, sum(di.quantity)::bigint as qty
    from public.delivery_items di
    join public.deliveries d on d.id = di.delivery_id
    where d.status <> 'CANCELLED'
      and di.order_item_id in (select l.item_id from lines l)
    group by di.order_item_id, d.scheduled_date
  ),
  sched as (
    select b.item_id, sum(b.qty)::bigint as scheduled_qty, count(*)::int as date_count,
           min(b.scheduled_date) as first_date, max(b.scheduled_date) as last_date
    from by_date b
    group by b.item_id
  ),
  info as (
    select l.*, coalesce(s.scheduled_qty, 0) as scheduled_qty, coalesce(s.date_count, 0) as date_count,
           s.first_date, s.last_date
    from lines l
    left join sched s on s.item_id = l.item_id
  ),
  buckets as (
    -- Nothing allocated yet: each active delivery quantity is fully uncovered at its own date.
    select n.product_id, n.order_id, b.scheduled_date as needed_date, 'DELIVERY_DATE'::text as basis,
           b.qty as qty, null::date as first_date, null::date as last_date
    from info n
    join by_date b on b.item_id = n.item_id
    where n.allocated_quantity = 0
    union all
    -- Nothing allocated yet: the part not assigned to any delivery has no date.
    select n.product_id, n.order_id, null::date, 'UNSCHEDULED',
           (n.quantity - n.scheduled_qty)::bigint, null::date, null::date
    from info n
    where n.allocated_quantity = 0 and n.quantity > n.scheduled_qty
    union all
    -- Partly allocated, fully scheduled on one date: the remainder is at that date.
    select n.product_id, n.order_id, n.first_date, 'DELIVERY_DATE',
           n.remaining::bigint, null::date, null::date
    from info n
    where n.allocated_quantity > 0 and n.date_count = 1 and n.scheduled_qty = n.quantity
    union all
    -- Partly allocated, no delivery at all: no date exists.
    select n.product_id, n.order_id, null::date, 'UNSCHEDULED',
           n.remaining::bigint, null::date, null::date
    from info n
    where n.allocated_quantity > 0 and n.date_count = 0
    union all
    -- Partly allocated and the remainder may sit on several dates or on the unscheduled part.
    select n.product_id, n.order_id, null::date, 'DATE_UNDETERMINED',
           n.remaining::bigint, n.first_date, n.last_date
    from info n
    where n.allocated_quantity > 0 and n.date_count > 0
      and not (n.date_count = 1 and n.scheduled_qty = n.quantity)
  )
  select k.product_id, k.needed_date, k.basis, count(distinct k.order_id)::int, sum(k.qty)::bigint,
         min(k.first_date), max(k.last_date)
  from buckets k
  where k.qty > 0
  group by k.product_id, k.needed_date, k.basis
  order by k.product_id, k.needed_date nulls last, k.basis;
end;
$$;

revoke all on function public.future_committed_demand() from public, anon;
grant execute on function public.future_committed_demand() to authenticated;
