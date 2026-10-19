-- ORD-003..010: pricing, discount ceiling, draft save, state transitions, cancel, void.
-- All order changes go through these SECURITY DEFINER functions: validated, atomic, audited.
-- User-facing business-rule errors use errcode P0001 with a Vietnamese message the UI can show.
--
-- Rules (PRD §19, TECH_DESIGN §6):
--   gross = sum(list_price x quantity)  (list price snapshot, taken from products — never from the client)
--   net   = gross - discount
--   customer discount <= base commission of the order (floor of the exact sum; the docs do not define
--   rounding, flooring is the conservative choice so the ceiling is never exceeded)
--   base commission per line = gross_line x rate, rate resolved by COM-001 priority at the order date.

-- ---------------------------------------------------------------------------
-- Commission rate resolution (COM-001 priority):
--   1 User+Product, 2 User, 3 Role+Product, 4 Role, 5 product default.
-- Among rules of the same priority the most recent effective_from (then created_at) wins.
-- ---------------------------------------------------------------------------
create or replace function private.resolve_commission_rate(p_user_id uuid, p_product_id uuid, p_on date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select p.id as user_id, p.role_id from public.profiles p where p.id = p_user_id
  ),
  candidates as (
    select 1 as prio, r.rate_percent, r.effective_from, r.created_at
    from public.commission_rules r, me
    where r.is_active and r.user_id = me.user_id and r.product_id = p_product_id
      and r.effective_from <= p_on and (r.effective_to is null or r.effective_to >= p_on)
    union all
    select 2, r.rate_percent, r.effective_from, r.created_at
    from public.commission_rules r, me
    where r.is_active and r.user_id = me.user_id and r.product_id is null
      and r.effective_from <= p_on and (r.effective_to is null or r.effective_to >= p_on)
    union all
    select 3, r.rate_percent, r.effective_from, r.created_at
    from public.commission_rules r, me
    where r.is_active and r.role_id = me.role_id and r.product_id = p_product_id
      and r.effective_from <= p_on and (r.effective_to is null or r.effective_to >= p_on)
    union all
    select 4, r.rate_percent, r.effective_from, r.created_at
    from public.commission_rules r, me
    where r.is_active and r.role_id = me.role_id and r.product_id is null
      and r.effective_from <= p_on and (r.effective_to is null or r.effective_to >= p_on)
  )
  select coalesce(
    (select c.rate_percent from candidates c order by c.prio, c.effective_from desc, c.created_at desc limit 1),
    (select pr.default_commission_rate from public.products pr where pr.id = p_product_id),
    0
  )
$$;

-- Business date in Vietnam (the campaign runs there); used to pick effective commission rules.
create or replace function private.business_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date
$$;

-- Parses and prices order lines for an owner: validates products, merges duplicate products,
-- snapshots the current list price and resolves the commission rate.
create or replace function private.price_lines(p_owner_user_id uuid, p_items jsonb)
returns table (
  product_id uuid,
  quantity int,
  list_price bigint,
  gross_line_amount bigint,
  commission_rate numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_on date := private.business_today();
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Đơn hàng cần có ít nhất một sản phẩm.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e -> 'product_id') <> 'string'
       or jsonb_typeof(e -> 'quantity') <> 'number'
       or (e ->> 'quantity') !~ '^[1-9][0-9]{0,8}$'
  ) then
    raise exception 'Mỗi dòng sản phẩm cần có sản phẩm và số lượng là số nguyên dương.';
  end if;

  if exists (
    select 1
    from (select (e ->> 'product_id')::uuid as pid from jsonb_array_elements(p_items) e) x
    left join public.products pr on pr.id = x.pid
    where pr.id is null or not pr.is_active
  ) then
    raise exception 'Có sản phẩm không tồn tại hoặc đã ngừng bán. Vui lòng chọn lại sản phẩm.';
  end if;

  return query
  select
    pr.id,
    t.qty::int,
    pr.list_price,
    (pr.list_price * t.qty)::bigint,
    private.resolve_commission_rate(p_owner_user_id, pr.id, v_on)
  from (
    select (e ->> 'product_id')::uuid as pid, sum((e ->> 'quantity')::bigint)::bigint as qty
    from jsonb_array_elements(p_items) e
    group by 1
  ) t
  join public.products pr on pr.id = t.pid
  order by pr.sku;
end;
$$;

-- Largest customer discount allowed: floor(sum(gross_line x rate / 100)).
create or replace function private.discount_ceiling(p_gross_lines bigint[], p_rates numeric[])
returns bigint
language sql
immutable
set search_path = ''
as $$
  select coalesce(floor(sum(g * r / 100.0))::bigint, 0)
  from unnest(p_gross_lines, p_rates) as t(g, r)
$$;

-- The caller must be an order-creating user; only Admin may act for another owner,
-- and an owner must be an active user who can hold orders.
create or replace function private.assert_order_owner(p_owner uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_create_orders() then
    raise exception 'Bạn không có quyền tạo hoặc xem đơn hàng.' using errcode = '42501';
  end if;
  if p_owner is distinct from (select auth.uid()) and not private.is_admin() then
    raise exception 'Chỉ Admin được tạo đơn thay cho người khác.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p join public.roles r on r.id = p.role_id
    where p.id = p_owner and p.is_active
      and r.code in ('ADMIN', 'SALE_B2B', 'STORE_STAFF', 'FRANCHISE_STAFF')
  ) then
    raise exception 'Người phụ trách đơn không hợp lệ hoặc đã ngừng hoạt động.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- quote_order: live totals + maximum discount for the form (Sales cannot read commission_rules).
-- ---------------------------------------------------------------------------
create or replace function public.quote_order(p_owner_user_id uuid default null, p_items jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid := coalesce(p_owner_user_id, (select auth.uid()));
  v_lines jsonb;
  v_gross bigint;
  v_ceiling bigint;
begin
  perform private.assert_order_owner(v_owner);

  select
    jsonb_agg(jsonb_build_object(
      'product_id', l.product_id, 'quantity', l.quantity, 'list_price', l.list_price,
      'gross_line_amount', l.gross_line_amount, 'commission_rate', l.commission_rate)),
    sum(l.gross_line_amount),
    private.discount_ceiling(array_agg(l.gross_line_amount), array_agg(l.commission_rate))
  into v_lines, v_gross, v_ceiling
  from private.price_lines(v_owner, p_items) l;

  return jsonb_build_object(
    'gross_amount', v_gross,
    'max_discount_amount', least(v_ceiling, v_gross),
    'lines', v_lines
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- save_draft_order: create (p_order_id null) or fully replace a DRAFT order.
-- ---------------------------------------------------------------------------
create or replace function public.save_draft_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_discount_amount bigint default 0,
  p_owner_user_id uuid default null,
  p_creation_location_id uuid default null,
  p_sales_channel_id uuid default null,
  p_lead_source_id uuid default null,
  p_requires_invoice boolean default false,
  p_notes text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_existing public.orders;
  v_owner uuid;
  v_profile public.profiles;
  v_location uuid;
  v_channel uuid;
  v_source uuid;
  v_gross bigint;
  v_ceiling bigint;
  v_discount bigint := coalesce(p_discount_amount, 0);
  v_order public.orders;
begin
  if not private.can_create_orders() then
    raise exception 'Bạn không có quyền tạo hoặc sửa đơn hàng.' using errcode = '42501';
  end if;

  if p_order_id is not null then
    select * into v_existing from public.orders where id = p_order_id for update;
    if not found
       or not (private.is_admin() or v_existing.owner_user_id = v_uid or v_existing.created_by = v_uid) then
      raise exception 'Không tìm thấy đơn hàng hoặc bạn không có quyền sửa đơn này.';
    end if;
    if v_existing.status <> 'DRAFT' then
      raise exception 'Chỉ sửa được đơn nháp. Đơn đã gửi/xác nhận không được đổi khách, số lượng hay giá: hãy hủy đơn cũ và tạo đơn mới.';
    end if;
  end if;

  v_owner := coalesce(p_owner_user_id, v_existing.owner_user_id, v_uid);
  perform private.assert_order_owner(v_owner);

  select * into v_profile from public.profiles where id = v_uid;
  v_location := coalesce(p_creation_location_id, v_existing.creation_location_id, v_profile.default_location_id);
  v_channel := coalesce(p_sales_channel_id, v_existing.sales_channel_id, v_profile.default_sales_channel_id);
  v_source := coalesce(p_lead_source_id, v_existing.lead_source_id, v_profile.default_lead_source_id);

  if v_location is null or v_channel is null or v_source is null then
    raise exception 'Vui lòng chọn điểm tạo đơn, kênh bán và nguồn khách.';
  end if;
  if not exists (select 1 from public.locations where id = v_location and is_active) then
    raise exception 'Điểm tạo đơn không hợp lệ hoặc đã ngừng sử dụng.';
  end if;
  if not exists (select 1 from public.sales_channels where id = v_channel and is_active) then
    raise exception 'Kênh bán không hợp lệ hoặc đã ngừng sử dụng.';
  end if;
  if not exists (select 1 from public.lead_sources where id = v_source and is_active) then
    raise exception 'Nguồn khách không hợp lệ hoặc đã ngừng sử dụng.';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and not is_archived) then
    raise exception 'Vui lòng chọn khách hàng hợp lệ (khách chưa bị lưu trữ).';
  end if;
  if v_discount < 0 then
    raise exception 'Giảm giá không được âm.';
  end if;

  -- Price from the products table (client never supplies prices) and check the discount ceiling.
  select sum(l.gross_line_amount),
         private.discount_ceiling(array_agg(l.gross_line_amount), array_agg(l.commission_rate))
    into v_gross, v_ceiling
  from private.price_lines(v_owner, p_items) l;

  if v_discount > v_gross then
    raise exception 'Giảm giá không được vượt quá giá trị đơn hàng.';
  end if;
  if v_discount > v_ceiling then
    raise exception 'Giảm giá vượt mức hoa hồng cho phép. Tối đa % đ cho đơn này.', v_ceiling;
  end if;

  if v_existing.id is null then
    insert into public.orders (
      customer_id, owner_user_id, created_by, creation_location_id, sales_channel_id, lead_source_id,
      gross_amount, discount_amount, net_amount, requires_invoice, notes, order_code
    ) values (
      p_customer_id, v_owner, v_uid, v_location, v_channel, v_source,
      v_gross, v_discount, v_gross - v_discount, coalesce(p_requires_invoice, false),
      nullif(btrim(coalesce(p_notes, '')), ''), ''
    ) returning * into v_order;
  else
    update public.orders set
      customer_id = p_customer_id,
      owner_user_id = v_owner,
      creation_location_id = v_location,
      sales_channel_id = v_channel,
      lead_source_id = v_source,
      gross_amount = v_gross,
      discount_amount = v_discount,
      net_amount = v_gross - v_discount,
      requires_invoice = coalesce(p_requires_invoice, false),
      notes = nullif(btrim(coalesce(p_notes, '')), '')
    where id = v_existing.id
    returning * into v_order;
    delete from public.order_items where order_id = v_order.id;
  end if;

  insert into public.order_items (order_id, product_id, quantity, list_price, gross_line_amount)
  select v_order.id, l.product_id, l.quantity, l.list_price, l.gross_line_amount
  from private.price_lines(v_owner, p_items) l;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- transition_order: the only way users move an order between states.
-- Actions: submit, return_to_draft, confirm (Admin), cancel, void (Admin).
-- System-driven transitions (deposit paid, reserved, delivered, ...) are added by their epics.
-- ---------------------------------------------------------------------------
create or replace function public.transition_order(
  p_order_id uuid,
  p_action text,
  p_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean := private.is_admin();
  v_order public.orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ceiling bigint;
  v_new text;
begin
  if not private.can_create_orders() then
    raise exception 'Bạn không có quyền thao tác đơn hàng.' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not (v_admin or v_order.owner_user_id = v_uid or v_order.created_by = v_uid) then
    raise exception 'Không tìm thấy đơn hàng hoặc bạn không có quyền thao tác đơn này.';
  end if;

  if p_action = 'submit' then
    if v_order.status <> 'DRAFT' then
      raise exception 'Chỉ gửi được đơn nháp.';
    end if;
    if not exists (select 1 from public.order_items where order_id = v_order.id) then
      raise exception 'Đơn hàng cần có ít nhất một sản phẩm trước khi gửi.';
    end if;
    -- Commission rates may have changed since the draft was saved: check the ceiling again.
    select private.discount_ceiling(array_agg(i.gross_line_amount),
             array_agg(private.resolve_commission_rate(v_order.owner_user_id, i.product_id, private.business_today())))
      into v_ceiling
    from public.order_items i where i.order_id = v_order.id;
    if v_order.discount_amount > v_ceiling then
      raise exception 'Giảm giá hiện vượt mức hoa hồng cho phép (tối đa % đ). Vui lòng sửa lại đơn nháp.', v_ceiling;
    end if;
    v_new := 'WAITING_CONFIRMATION';

  elsif p_action = 'return_to_draft' then
    if v_order.status <> 'WAITING_CONFIRMATION' then
      raise exception 'Chỉ đưa được về nháp khi đơn đang chờ xác nhận.';
    end if;
    if v_order.paid_amount > 0 then
      raise exception 'Đơn đã có thanh toán nên không thể đưa về nháp.';
    end if;
    v_new := 'DRAFT';

  elsif p_action = 'confirm' then
    if not v_admin then
      raise exception 'Chỉ Admin được xác nhận đơn.' using errcode = '42501';
    end if;
    if v_order.status <> 'WAITING_CONFIRMATION' then
      raise exception 'Chỉ xác nhận được đơn đang chờ xác nhận.';
    end if;
    v_new := 'WAITING_DEPOSIT';

  elsif p_action = 'cancel' then
    if v_reason is null then
      raise exception 'Vui lòng nhập lý do hủy đơn.';
    end if;
    if v_order.status not in ('DRAFT', 'WAITING_CONFIRMATION', 'WAITING_DEPOSIT', 'CONFIRMED', 'RESERVED') then
      raise exception 'Đơn ở trạng thái % không thể hủy.', v_order.status;
    end if;
    if v_order.status in ('CONFIRMED', 'RESERVED') and not v_admin then
      raise exception 'Đơn đã xác nhận chỉ Admin được hủy.' using errcode = '42501';
    end if;
    if v_order.paid_amount > 0 then
      raise exception 'Đơn đã có thanh toán. Cần hoàn/hủy thanh toán trước khi hủy đơn.';
    end if;
    -- Releasing temporary reservations is added with E05 (reservations do not exist yet).
    v_new := 'CANCELLED';

  elsif p_action = 'void' then
    if not v_admin then
      raise exception 'Chỉ Admin được vô hiệu hóa đơn.' using errcode = '42501';
    end if;
    if v_reason is null then
      raise exception 'Vui lòng nhập lý do vô hiệu hóa đơn.';
    end if;
    if v_order.status not in ('DRAFT', 'WAITING_CONFIRMATION', 'WAITING_DEPOSIT', 'CONFIRMED') then
      raise exception 'Đơn ở trạng thái % không thể vô hiệu hóa.', v_order.status;
    end if;
    if v_order.paid_amount > 0 then
      raise exception 'Đơn đã có thanh toán. Cần hoàn/hủy thanh toán trước khi vô hiệu hóa đơn.';
    end if;
    v_new := 'VOIDED';

  else
    raise exception 'Thao tác không hợp lệ: %', p_action;
  end if;

  -- The reason is picked up by the status history and audit triggers in this transaction.
  perform set_config('app.audit_reason', coalesce(v_reason, ''), true);

  update public.orders set
    status = v_new,
    cancelled_at = case when v_new = 'CANCELLED' then now() else cancelled_at end,
    cancel_reason = case when v_new = 'CANCELLED' then v_reason else cancel_reason end,
    voided_at = case when v_new = 'VOIDED' then now() else voided_at end,
    void_reason = case when v_new = 'VOIDED' then v_reason else void_reason end
  where id = v_order.id
  returning * into v_order;

  perform set_config('app.audit_reason', '', true);
  return v_order;
end;
$$;

revoke all on function private.resolve_commission_rate(uuid, uuid, date), private.business_today(),
  private.price_lines(uuid, jsonb), private.discount_ceiling(bigint[], numeric[]),
  private.assert_order_owner(uuid) from public, anon;
grant execute on function private.resolve_commission_rate(uuid, uuid, date), private.business_today(),
  private.price_lines(uuid, jsonb), private.discount_ceiling(bigint[], numeric[]),
  private.assert_order_owner(uuid) to authenticated, service_role;

revoke all on function public.quote_order(uuid, jsonb) from public, anon;
revoke all on function public.save_draft_order(uuid, uuid, jsonb, bigint, uuid, uuid, uuid, uuid, boolean, text) from public, anon;
revoke all on function public.transition_order(uuid, text, text) from public, anon;
grant execute on function public.quote_order(uuid, jsonb) to authenticated;
grant execute on function public.save_draft_order(uuid, uuid, jsonb, bigint, uuid, uuid, uuid, uuid, boolean, text) to authenticated;
grant execute on function public.transition_order(uuid, text, text) to authenticated;
