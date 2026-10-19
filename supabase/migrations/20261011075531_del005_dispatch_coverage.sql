-- DEL-005: a delivery may leave its source only when its own lines are fully covered.
-- The order row lock in transition_delivery serialises sibling dispatches. The later
-- bind_delivery_item_batches call assigns the pooled reservation's exact batches
-- in the same transaction; a failed bind rolls back the transition and audit.
create or replace function private.assert_delivery_stock(p_delivery_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_delivery public.deliveries;
  v_line record;
  v_count int := 0;
  v_logistics int;
  v_claimed int;
  v_held int;
begin
  select * into v_delivery from public.deliveries where id = p_delivery_id;
  if not found then
    raise exception 'Không tìm thấy đợt giao.' using errcode = 'P0001';
  end if;

  for v_line in
    select di.order_item_id, p.sku, l.code as location_code, di.quantity,
      coalesce(c.covered, 0) as covered,
      coalesce(c.gap, di.quantity) as gap
    from public.delivery_items di
    join public.products p on p.id = di.product_id
    join public.locations l on l.id = v_delivery.source_location_id
    left join lateral private.delivery_stock_coverage(
      di.order_item_id, v_delivery.source_location_id
    ) c on c.delivery_id = di.delivery_id
    where di.delivery_id = p_delivery_id
    order by p.sku
  loop
    v_count := v_count + 1;
    -- Attribution rows are immutable history. After a source/quantity edit, old rows
    -- can outnumber the live reservation and the coverage waterfall must not let an
    -- earlier sibling claim stock newly reserved for this delivery. Redispatch uses
    -- its already committed batch binding instead of reinterpreting history.
    if v_delivery.dispatched_at is null then
      select coalesce(sum(least(di2.quantity, coalesce(a.qty, 0))), 0)::int
      into v_claimed
      from public.delivery_items di2
      join public.deliveries d2 on d2.id = di2.delivery_id
      left join lateral (
        select sum(a2.quantity)::int as qty
        from public.delivery_stock_allocations a2
        where a2.delivery_id = d2.id and a2.order_item_id = di2.order_item_id
          and a2.location_id = v_delivery.source_location_id
      ) a on true
      where di2.order_item_id = v_line.order_item_id
        and d2.source_location_id = v_delivery.source_location_id
        and d2.status not in ('DELIVERED', 'CANCELLED');
      v_held := private.reserved_physical_qty(
        v_line.order_item_id, v_delivery.source_location_id
      );
      if v_claimed > v_held then
        raise exception 'Chưa thể xác định phần hàng giữ riêng cho đợt giao % tại kho %: lịch sử phân bổ % vượt lượng đang giữ % của %. Admin/Kho cần đối soát hoặc phân bổ thêm trước khi xuất.',
          v_delivery.delivery_code, v_line.location_code, v_claimed, v_held, v_line.sku
          using errcode = 'P0001';
      end if;
    end if;
    if v_line.gap > 0 then
      v_logistics := private.delivery_logistics_qty(
        v_line.order_item_id, v_delivery.source_location_id, p_delivery_id
      );
      if v_logistics > 0 then
        raise exception 'Chưa đủ hàng đã phân bổ cho đợt giao %: thiếu % % tại kho % (đã giữ %, cần %; % đang ở logistics). Hãy phân bổ cho đợt này hoặc điều chuyển hàng đến kho xuất.',
          v_delivery.delivery_code, v_line.gap, v_line.sku, v_line.location_code,
          v_line.covered, v_line.quantity, v_logistics using errcode = 'P0001';
      end if;
      raise exception 'Chưa đủ hàng đã phân bổ cho đợt giao %: thiếu % % tại kho % (đã giữ %, cần %). Hãy phân bổ cho đợt này hoặc điều chuyển hàng đến kho xuất.',
        v_delivery.delivery_code, v_line.gap, v_line.sku, v_line.location_code,
        v_line.covered, v_line.quantity using errcode = 'P0001';
    end if;
  end loop;

  if v_count = 0 then
    raise exception 'Đợt giao % chưa có sản phẩm, không thể xuất kho.', v_delivery.delivery_code
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function private.assert_delivery_stock(uuid) from public, anon, authenticated;
