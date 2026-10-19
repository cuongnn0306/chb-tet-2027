-- CUS-005: customer purchase history summary (number of orders, total gross, latest order).
-- Used by the duplicate suggestion ("3 đơn trước | 4,8 triệu") and the customer list.
--
-- Counts real orders only: everything past DRAFT that is not CANCELLED or VOIDED.
-- Gross (list price x quantity) is the sales figure, not cash collected (PRD §19.1).
--
-- SECURITY DEFINER on purpose: a salesperson sees the customer's whole history, not only
-- their own orders, so repeat customers can be recognised (PRD §5.3). Only these three
-- aggregates are exposed, never individual orders of other users.

create or replace function public.customer_order_summary(p_customer_ids uuid[])
returns table (
  customer_id uuid,
  order_count int,
  total_gross bigint,
  last_order_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_create_orders() then
    raise exception 'Bạn không có quyền xem lịch sử khách hàng.' using errcode = '42501';
  end if;

  return query
  select
    o.customer_id,
    count(*)::int,
    coalesce(sum(o.gross_amount), 0)::bigint,
    max(o.created_at)
  from public.orders o
  where o.customer_id = any (coalesce(p_customer_ids, '{}'::uuid[]))
    and o.status not in ('DRAFT', 'CANCELLED', 'VOIDED')
  group by o.customer_id;
end;
$$;

revoke all on function public.customer_order_summary(uuid[]) from public, anon;
grant execute on function public.customer_order_summary(uuid[]) to authenticated;
