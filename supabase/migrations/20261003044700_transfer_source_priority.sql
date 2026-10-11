-- RES-010 / RV-08: rank source expiry explicitly instead of positional column 5 (quantity).
-- Keep the existing sellable/safety-stock rules, RPC contract and permissions.
create or replace function private.transfer_sources(p_product_id uuid, p_destination_id uuid, p_needed int)
returns table (
  location_id uuid,
  location_code text,
  location_name text,
  region text,
  sellable_qty int,
  same_region boolean,
  covers_all boolean,
  earliest_expiry date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.id as location_id,
    l.code as location_code,
    l.name as location_name,
    l.region,
    private.sellable_qty(l.id, p_product_id) as sellable_qty,
    (l.region is not null and l.region = d.region) as same_region,
    (private.sellable_qty(l.id, p_product_id) >= p_needed) as covers_all,
    (select min(pb.expiry_date)
       from public.inventory_balances b join public.product_batches pb on pb.id = b.batch_id
      where b.location_id = l.id and b.product_id = p_product_id
        and pb.status = 'ACTIVE' and pb.expiry_date >= private.business_today()
        and b.available_qty - b.reserved_qty > 0) as earliest_expiry
  from public.locations l
  cross join (select region from public.locations where id = p_destination_id) d
  where l.is_active and l.id <> p_destination_id
    and private.sellable_qty(l.id, p_product_id) > 0
  order by same_region desc, covers_all desc, earliest_expiry asc nulls last,
    sellable_qty desc, location_code;
$$;
