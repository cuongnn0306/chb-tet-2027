-- DEL-005 correction: attributed coverage may never exceed what is still actively reserved.
--
-- delivery_stock_allocations is append-only history ("units were reserved for this delivery at this
-- location"). A delivery that is still PREPARING can have its source or quantity edited (save_delivery), and
-- the units reserved at another source can be released by a later allocation. Counting the historical sum as
-- coverage then reports a delivery as covered while nothing is held, e.g. allocate at A, edit the source to B,
-- allocate B (which releases A's surplus), edit the source back to A: the old A attribution still said "covered".
--
-- Fix (additive, same signature, history untouched): attribution counts for a delivery only up to the delivery's
-- quantity AND only while units are actually reserved at the location, handing the reserved units to open
-- deliveries in the same priority order the unattributed pool already uses (goods in logistics first, then date,
-- time, creation). Whatever is not covered shows up as the delivery's gap, so allocate_delivery_stock reserves it
-- (and takes back surplus held at other locations) exactly as for a never-allocated delivery.
--
-- Quantity edits follow from the same rule: lowering a quantity leaves the extra units reserved (they become pool
-- or releasable surplus); raising it leaves only the difference as the gap; a stale larger attribution can never
-- count beyond the live reservation.
create or replace function private.delivery_stock_coverage(p_order_item_id uuid, p_location_id uuid)
returns table (delivery_id uuid, quantity int, attributed int, pool_share int, covered int, gap int)
language sql
stable
security definer
set search_path = ''
as $$
  with held as (
    select private.reserved_physical_qty(p_order_item_id, p_location_id)::int as qty
  ),
  open_d as (
    select d.id as delivery_id, di.quantity,
      least(di.quantity, coalesce((
        select sum(a.quantity) from public.delivery_stock_allocations a
        where a.delivery_id = d.id and a.order_item_id = di.order_item_id and a.location_id = p_location_id
      ), 0))::int as wanted,
      row_number() over (
        order by (d.dispatched_at is null), d.scheduled_date, d.scheduled_time nulls last, d.created_at, d.id
      ) as prio
    from public.delivery_items di
    join public.deliveries d on d.id = di.delivery_id
    where di.order_item_id = p_order_item_id and d.source_location_id = p_location_id
      and d.status not in ('DELIVERED', 'CANCELLED')
  ),
  capped as (
    select o.delivery_id, o.quantity, o.prio,
      least(
        o.wanted,
        greatest((select h.qty from held h) - coalesce(sum(o.wanted) over (
          order by o.prio rows between unbounded preceding and 1 preceding
        ), 0), 0)
      )::int as attributed
    from open_d o
  ),
  pool as (
    select greatest((select h.qty from held h) - coalesce(sum(c.attributed), 0), 0)::int as qty
    from capped c
  ),
  waterfall as (
    select c.delivery_id, c.quantity, c.attributed,
      (c.quantity - c.attributed) as deficit,
      coalesce(sum(c.quantity - c.attributed) over (
        order by c.prio rows between unbounded preceding and 1 preceding
      ), 0) as ahead
    from capped c
  ),
  shares as (
    select w.delivery_id, w.quantity, w.attributed,
      least(w.deficit, greatest((select p.qty from pool p) - w.ahead, 0))::int as pool_share
    from waterfall w
  )
  select s.delivery_id, s.quantity, s.attributed, s.pool_share,
    (s.attributed + s.pool_share)::int, (s.quantity - s.attributed - s.pool_share)::int
  from shares s
$$;

revoke all on function private.delivery_stock_coverage(uuid, uuid) from public, anon, authenticated;
