-- SEC-002 / RV-12: immutable before/after audit for the Admin review of provider payment events.
-- docs/reviews/2026-10-02-project-review.md RV-12, PRD §Audit (Thanh toán), AGENTS §7 (audit sensitive Admin actions).
--
-- Finding: assign_payment_event / dismiss_payment_event changed payment_events without any audit_logs row.
-- dismiss_payment_event overwrote `note` (which holds the system's reason for the review, e.g. "amount larger
-- than the remaining balance") and left no history of the previous value.
--
-- Why a trigger and not an audit call inside each RPC (decision, see docs/exec-plans/active/SEC-002-*.md):
--   * The audit row is written by the same statement that records the decision, so it commits or rolls back
--     with it: a failed, refused or rolled-back decision can never leave an audit row, and a successful one can
--     never miss it (an RPC-local insert would have to be remembered in every present and future resolver).
--   * assign_payment_event and dismiss_payment_event stay byte-for-byte unchanged (permissions, idempotency
--     checks, payment credit, messages), as do the webhook processor and the payment_events guard.
--   * The only writers that ever set resolved_at are those two RPCs. The webhook processor updates `outcome`,
--     `note`, `order_id`, `payment_id` of a freshly received event but never `resolved_at`, so system outcomes
--     are not mislabelled as Admin decisions. A generic row-audit trigger (private.audit_row_change) would do
--     both wrongly AND copy the whole row, including the raw webhook payload, into audit_logs: it is not used.
--
-- What is recorded (one row per decision, entity_type 'payment_events', entity_id = the event row id):
--   action        review_assign   an UNMATCHED event was given to an order (a payment was created)
--                 review_dismiss  an UNMATCHED / NEEDS_REVIEW event was closed with an Admin note
--   actor_user_id the Admin (resolved_by, falling back to the session user)
--   before_data / after_data  ONLY the decision fields below. The raw payload (account number, content,
--                 reference code, amount...) is never copied.
--   reason        dismiss: the Admin's note (required by the RPC); assign: fixed text, the RPC takes no reason
--   created_at    the transaction time, identical to resolved_at of the event

create or replace function private.payment_event_decision_fields(p_event public.payment_events)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'provider', p_event.provider,
    'provider_event_id', p_event.provider_event_id,
    'outcome', p_event.outcome,
    'order_id', p_event.order_id,
    'payment_id', p_event.payment_id,
    'note', p_event.note,
    'resolved_at', p_event.resolved_at,
    'resolved_by', p_event.resolved_by
  )
$$;

create or replace function private.payment_events_audit_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Only assign_payment_event attaches a payment to an event that had none.
  v_assign boolean := old.payment_id is null and new.payment_id is not null;
begin
  insert into public.audit_logs (actor_user_id, entity_type, entity_id, action, before_data, after_data, reason)
  values (
    coalesce(new.resolved_by, (select auth.uid())),
    'payment_events',
    new.id,
    case when v_assign then 'review_assign' else 'review_dismiss' end,
    private.payment_event_decision_fields(old),
    private.payment_event_decision_fields(new),
    case when v_assign
      then 'Admin gán thủ công giao dịch chưa khớp vào đơn hàng'
      else nullif(btrim(coalesce(new.note, '')), '')
    end
  );
  return null;
end;
$$;

-- Fires only when an event goes from unresolved to resolved. Repeated or refused decisions never get this far
-- (the RPCs update only unresolved rows), and an update that does not touch resolved_at is not a decision.
create trigger payment_events_audit_review_after_update
  after update of resolved_at on public.payment_events
  for each row
  when (old.resolved_at is null and new.resolved_at is not null)
  execute function private.payment_events_audit_review();

revoke all on function private.payment_event_decision_fields(public.payment_events),
  private.payment_events_audit_review() from public, anon, authenticated;
