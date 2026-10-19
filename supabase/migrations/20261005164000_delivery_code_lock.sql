-- DEL-001 (review RV-09): delivery code assignment is serialised per order.
--
-- private.deliveries_guard() assigned order-code || lpad(count(*) + 1, 2, '0') with no lock, so two
-- concurrent plans of the same order could both count N rows, compute the same code and one of them
-- failed on the unique delivery_code even though the total quantity was valid. lpad(..., 2, '0') also
-- truncates, so the 100th delivery of an order would have been numbered "-10".
--
-- Fix, inside the guard (so every insert path is covered, not only save_delivery):
--   * a transaction-scoped advisory lock keyed by the order is taken BEFORE counting; the second
--     transaction waits until the first commits or rolls back, then counts a snapshot that includes it.
--     An advisory lock is used instead of a row lock on public.orders so the guard cannot deadlock with
--     the order FOR UPDATE already taken by transition_delivery / allocation, nor with FK key-share locks.
--   * the suffix is zero-padded to at least two digits and never truncated (01 .. 99, 100, 101, ...).
--
-- Everything else is the guard of 20261002060000_delivery_failed_logistics.sql, unchanged: the delete
-- ban, the immutable order/code/created_at, the transition table, the write-once dispatched_at, the
-- no-cancel-after-dispatch rule, the frozen plan and the fixed source after dispatch. Deliveries are
-- never deleted, so count(*) is monotonic per order and count + 1 stays unique under the lock.
-- No schema, status, RLS, grant or service signature changes.

create or replace function private.deliveries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_seq int;
begin
  if tg_op = 'DELETE' then
    raise exception 'Không được xóa đợt giao hàng. Hãy hủy đợt giao kèm lý do.';
  end if;

  if tg_op = 'INSERT' then
    -- Serialise code assignment per order before counting (released at commit/rollback).
    perform pg_advisory_xact_lock(hashtextextended('public.deliveries.delivery_code:' || new.order_id::text, 0));

    -- Code = order code + position of the delivery within the order, e.g. TET000123-02, TET000123-100.
    select count(*) + 1 into v_seq from public.deliveries d where d.order_id = new.order_id;
    new.delivery_code := (select o.order_code from public.orders o where o.id = new.order_id)
      || '-' || case when v_seq < 10 then '0' || v_seq::text else v_seq::text end;
    new.dispatched_at := null;
    return new;
  end if;

  if new.order_id is distinct from old.order_id or new.delivery_code is distinct from old.delivery_code
     or new.created_at is distinct from old.created_at then
    raise exception 'Không được đổi đơn hay mã của đợt giao.';
  end if;

  if new.status is distinct from old.status and (old.status, new.status) not in (
    ('PREPARING', 'READY'), ('READY', 'OUT_FOR_DELIVERY'), ('OUT_FOR_DELIVERY', 'DELIVERED'),
    ('OUT_FOR_DELIVERY', 'FAILED'), ('FAILED', 'READY'), ('PREPARING', 'CANCELLED'), ('READY', 'CANCELLED')
  ) then
    raise exception 'Không thể chuyển đợt giao từ % sang %.', old.status, new.status;
  end if;

  -- The moment the goods left the warehouse: written by the first dispatch only, then immutable.
  if old.dispatched_at is not null then
    if new.dispatched_at is distinct from old.dispatched_at then
      raise exception 'Không được sửa thời điểm hàng rời kho của đợt giao.';
    end if;
  elsif new.status = 'OUT_FOR_DELIVERY' and old.status = 'READY' then
    new.dispatched_at := now();
  elsif new.dispatched_at is not null then
    raise exception 'Thời điểm hàng rời kho chỉ được ghi khi xuất kho đi giao.';
  end if;

  if new.status = 'CANCELLED' and new.dispatched_at is not null then
    raise exception 'Hàng của đợt giao này đã rời kho (đang ở logistics, chưa được kho nhận lại): không thể hủy đợt giao.';
  end if;

  -- Once the goods left (or the delivery is closed) the plan is frozen.
  if old.status in ('OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED') and (
       new.scheduled_date is distinct from old.scheduled_date or new.scheduled_time is distinct from old.scheduled_time
    or new.recipient_name is distinct from old.recipient_name or new.recipient_phone is distinct from old.recipient_phone
    or new.delivery_address is distinct from old.delivery_address or new.source_location_id is distinct from old.source_location_id
    or new.delivery_method is distinct from old.delivery_method or new.shipping_fee is distinct from old.shipping_fee
    or new.shipping_fee_payer is distinct from old.shipping_fee_payer
  ) then
    raise exception 'Đợt giao đã xuất kho hoặc đã đóng, không được sửa thông tin giao hàng.';
  end if;

  -- The source cannot move once goods have left it: the footprint is tied to that location.
  if old.dispatched_at is not null and new.source_location_id is distinct from old.source_location_id then
    raise exception 'Hàng của đợt giao đã rời kho xuất, không được đổi kho xuất.';
  end if;
  return new;
end;
$$;

-- create or replace keeps the existing trigger binding; privileges are re-stated for safety.
revoke all on function private.deliveries_guard() from public, anon, authenticated;
