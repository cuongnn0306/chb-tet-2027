-- INV-006: opening stock import (Admin). Template (plan §20):
--   Location Code | SKU | Batch | NSX | HSD | Qty
-- Rows arrive as JSON: { location_code, sku, batch_code, manufactured_date, expiry_date, quantity }.
--
-- Safety model:
--   * p_dry_run = true (default) validates EVERYTHING and returns every problem without changing data.
--   * p_dry_run = false applies the whole file atomically (one transaction: all rows or none) through
--     the normal posting function, so each row is an ADJUSTMENT_IN ledger movement ("Tồn đầu kỳ (import)").
--   * A batch that already exists is reused only if its dates match; otherwise the row is an error.
--   * The same batch may appear on several rows (different locations or repeated): quantities add up.

create or replace function public.import_opening_stock(
  p_rows jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_rows constant int := 5000;
  c_max_errors constant int := 100;
  v_count int;
  v_errors jsonb := '[]'::jsonb;
  v_error_count int := 0;
  v_row jsonb;
  v_i int;
  v_location public.locations;
  v_product public.products;
  v_batch public.product_batches;
  v_code text;
  v_mfd date;
  v_exp date;
  v_qty numeric;
  v_new_batches int := 0;
  v_total bigint := 0;
  v_seen jsonb := '{}'::jsonb;   -- "<sku>|<batch>" -> "<mfd>|<exp>" within this file
  v_key text;
  v_dates text;
  v_problem text;
begin
  if not private.is_admin() then
    raise exception 'Chỉ Admin được nhập tồn đầu kỳ.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'File nhập không có dòng dữ liệu nào.';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count > c_max_rows then
    raise exception 'Tối đa % dòng mỗi lần nhập (file có % dòng). Hãy chia nhỏ file.', c_max_rows, v_count;
  end if;

  -- ---- Pass 1: validate every row, collect problems ------------------------------------------
  for v_i in 0 .. v_count - 1 loop
    v_row := p_rows -> v_i;
    v_problem := null;

    select * into v_location from public.locations
    where code = upper(btrim(coalesce(v_row ->> 'location_code', ''))) and is_active;
    if not found then
      v_problem := 'Mã địa điểm "' || coalesce(v_row ->> 'location_code', '') || '" không tồn tại hoặc đã ngừng sử dụng.';
    end if;

    if v_problem is null then
      select * into v_product from public.products
      where sku = upper(btrim(coalesce(v_row ->> 'sku', ''))) and is_active;
      if not found then
        v_problem := 'SKU "' || coalesce(v_row ->> 'sku', '') || '" không tồn tại hoặc đã ngừng bán.';
      end if;
    end if;

    v_code := upper(btrim(coalesce(v_row ->> 'batch_code', '')));
    if v_problem is null and v_code = '' then
      v_problem := 'Thiếu mã lô.';
    end if;

    if v_problem is null then
      begin
        if coalesce(v_row ->> 'manufactured_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
           or coalesce(v_row ->> 'expiry_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'bad date';
        end if;
        v_mfd := (v_row ->> 'manufactured_date')::date;
        v_exp := (v_row ->> 'expiry_date')::date;
      exception when others then
        v_problem := 'Ngày sản xuất/hạn sử dụng không hợp lệ.';
      end;
    end if;
    if v_problem is null and v_exp < v_mfd then
      v_problem := 'Hạn sử dụng phải sau hoặc bằng ngày sản xuất.';
    end if;

    if v_problem is null then
      if jsonb_typeof(v_row -> 'quantity') <> 'number' or (v_row ->> 'quantity') !~ '^[0-9]{1,8}$'
         or (v_row ->> 'quantity')::numeric < 1 then
        v_problem := 'Số lượng phải là số nguyên từ 1 trở lên.';
      end if;
    end if;

    if v_problem is null then
      v_key := v_product.sku || '|' || v_code;
      v_dates := v_mfd::text || '|' || v_exp::text;
      if v_seen ? v_key and v_seen ->> v_key <> v_dates then
        v_problem := 'Lô ' || v_code || ' của ' || v_product.sku || ' xuất hiện nhiều lần với ngày khác nhau.';
      else
        v_seen := v_seen || jsonb_build_object(v_key, v_dates);
        select * into v_batch from public.product_batches
        where product_id = v_product.id and batch_code = v_code;
        if found and (v_batch.manufactured_date <> v_mfd or v_batch.expiry_date <> v_exp) then
          v_problem := 'Lô ' || v_code || ' của ' || v_product.sku || ' đã tồn tại với ngày khác ('
            || v_batch.manufactured_date || ' / ' || v_batch.expiry_date || ').';
        end if;
      end if;
    end if;

    if v_problem is not null then
      v_error_count := v_error_count + 1;
      if v_error_count <= c_max_errors then
        v_errors := v_errors || jsonb_build_object('row', v_i + 1, 'message', v_problem);
      end if;
    end if;
  end loop;

  if v_error_count > 0 then
    return jsonb_build_object('ok', false, 'dry_run', p_dry_run, 'error_count', v_error_count, 'errors', v_errors);
  end if;

  -- ---- Summary (also what a dry run reports) --------------------------------------------------
  select count(*) filter (where pb.id is null)
  into v_new_batches
  from (
    select distinct on (upper(btrim(r.value ->> 'sku')), upper(btrim(r.value ->> 'batch_code')))
           r.value as r
    from jsonb_array_elements(p_rows) as r
  ) d
  left join public.products p on p.sku = upper(btrim(d.r ->> 'sku'))
  left join public.product_batches pb on pb.product_id = p.id and pb.batch_code = upper(btrim(d.r ->> 'batch_code'));

  select sum((r.value ->> 'quantity')::bigint) into v_total from jsonb_array_elements(p_rows) as r;

  if p_dry_run then
    return jsonb_build_object('ok', true, 'dry_run', true, 'rows', v_count,
      'batches_to_create', v_new_batches, 'total_quantity', v_total);
  end if;

  -- ---- Pass 2: apply (same transaction: any failure rolls the whole file back) ----------------
  for v_i in 0 .. v_count - 1 loop
    v_row := p_rows -> v_i;
    select * into v_location from public.locations where code = upper(btrim(v_row ->> 'location_code'));
    select * into v_product from public.products where sku = upper(btrim(v_row ->> 'sku'));
    v_code := upper(btrim(v_row ->> 'batch_code'));

    select * into v_batch from public.product_batches where product_id = v_product.id and batch_code = v_code;
    if not found then
      insert into public.product_batches (batch_code, product_id, manufactured_date, expiry_date)
      values (v_code, v_product.id, (v_row ->> 'manufactured_date')::date, (v_row ->> 'expiry_date')::date)
      returning * into v_batch;
    end if;

    perform private.post_inventory_movement(
      'ADJUSTMENT_IN', v_product.id, v_batch.id, null, v_location.id,
      (v_row ->> 'quantity')::int, 'Tồn đầu kỳ (import)'
    );
  end loop;

  return jsonb_build_object('ok', true, 'dry_run', false, 'rows', v_count,
    'batches_created', v_new_batches, 'total_quantity', v_total);
end;
$$;

revoke all on function public.import_opening_stock(jsonb, boolean) from public, anon;
grant execute on function public.import_opening_stock(jsonb, boolean) to authenticated;
