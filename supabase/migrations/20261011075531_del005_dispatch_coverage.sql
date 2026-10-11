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
