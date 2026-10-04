# DEL-011: batch/pick binding + pre-dispatch sellability re-check (review RV-04/RV-05)

Source: `docs/reviews/2026-10-02-project-review.md` RV-04/RV-05, `docs/reviews/2026-10-02-DEL-012-review.md`.
TECH_DESIGN §3.19/§3.20/§7, §5.1/§5.2. Branch `feature/DEL-012-failed-logistics` (stacked, per
AUTOMATION_STATE assignment). Builds on DEL-012's `dispatched_at` marker and
`private.delivery_logistics_qty`.

## Problem

- RV-04: `delivery_detail`'s pick preview offsets the FEFO queue by `created_at` order of sibling
  deliveries; `consume_order_item_stock` (run at DELIVERED) ignores that offset entirely and always
  takes from the front of the ACTIVE reservation queue. If deliveries of the same order line/source are
  confirmed DELIVERED out of creation order, the ledger can book a different batch than the one the
  issue note showed, and reprinting after DELIVERED recomputes a live (and now different) slice instead
  of the recorded fact.
- RV-05: neither `assert_delivery_stock` (dispatch) nor `consume_order_item_stock` (deliver) re-checks
  that the allocated batch is still `ACTIVE` and not expired. FEFO allocation only filters on those
  conditions at `allocate_order` time; an Admin can flip a batch to `INACTIVE` any time, and
  `business_today()` advances while goods sit in `OUT_FOR_DELIVERY`/`FAILED`.

## Decision: bind at first dispatch, consume from the binding

A delivery's goods physically leave the warehouse at dispatch (`OUT_FOR_DELIVERY`), which is also the
moment DEL-012 freezes `dispatched_at`. We commit the FEFO batch/quantity split for every
`delivery_item` of the delivery **at that exact moment, once**, into a new table
`delivery_item_batches` (`delivery_item_id`, `batch_id`, `quantity`), and `consume_order_item_stock`
(now run at DELIVERED) consumes **exactly** those rows instead of recomputing FEFO. This makes the
note a recorded fact as soon as the delivery is dispatched; reprinting after DELIVERED (or while
`OUT_FOR_DELIVERY`/`FAILED`) reads the same rows, so it can never drift from the ledger.

- The offset used while binding is the sum of `delivery_item_batches.quantity` already committed to
  other deliveries of the same order line **at the same source** whose goods are still in logistics
  (`OUT_FOR_DELIVERY`/`FAILED`, matching `delivery_logistics_qty`'s own filter) — not creation order.
  This is what actually happened physically, regardless of which delivery was planned first.
- Binding only runs when `dispatched_at` is still `null` (the guard trigger already makes it
  immutable once set), so FAILED → reschedule → redispatch reuses the original rows: no re-pick, no
  double reservation/consumption, exactly like the DEL-012 logistics hold.
- The **pre-dispatch** preview in `delivery_detail` (`PREPARING`/`READY`, `dispatched_at is null`) is
  left exactly as it is: an estimate by creation order, since nothing is committed yet. Only the
  dispatched/committed branch is new. This keeps the existing "two open deliveries split the FEFO
  pick list, so nothing is picked twice" test unchanged.
- `TECH_DESIGN §3.20` lists a (nullable) single `delivery_items.batch_id`, which cannot represent a
  split across several batches; left unused, as before. The actually-consumed batches are traceable
  either way through `inventory_movements.delivery_id` (ledger) and now also through
  `delivery_item_batches` (the pre-consumption commitment). Flagging this as a documented deviation,
  not a silent rule invention.

## Decision: sellability re-check, not a swap

Add `private.assert_batch_sellable(batch_id)`: raises unless `status = 'ACTIVE'` and
`expiry_date >= business_today()`.

- **At dispatch**: `bind_delivery_item_batches` calls it for every batch it is about to bind. If a
  batch in the required FEFO slice is no longer sellable, the bind raises and the whole
  `transition_delivery('dispatch')` call rolls back — the delivery stays `READY`, no reservation or
  balance changes, no audit row (nothing committed). `assert_delivery_stock`'s existing quantity-only
  check is unchanged and still runs first (keeps its current error message/tests).
- **At deliver**: `consume_order_item_stock` re-checks the already-bound batch right before posting its
  `SALE_OUT` movement. If it has since become unsellable (deactivated, or expired while the delivery sat
  `OUT_FOR_DELIVERY`/`FAILED`), `deliver` is rejected atomically — no silent swap to a different batch,
  no partial ledger entry (the whole call rolls back).
- **Open decision (flag for a business owner, same posture as DEL-012's "kho nhận lại" gap):** what to
  do with a delivery whose bound batch expires/deactivates while already out for delivery is not
  specified anywhere (no re-allocation, no inspection, no override role). This change only blocks the
  transition safely; it does not invent a release/re-pick workflow. Until decided, such a delivery can
  only be delivered if the batch becomes sellable again (e.g. an Admin reactivating it), which is an
  existing capability, not a new one added here.

## Schema

`supabase/migrations/20261002070000_delivery_batch_binding.sql`:

- `public.delivery_item_batches(id, delivery_item_id, batch_id, quantity, created_at)`, unique
  `(delivery_item_id, batch_id)`, RLS mirrors `delivery_items_select` (order owner, Admin, Warehouse).
  Guarded like `inventory_balances`/`inventory_reservations`: only `private.post_inventory_movement`'s
  gate flag may insert/accumulate it; delete is always refused. Audited (insert only).
- `private.assert_batch_sellable(uuid)`, `private.bind_delivery_item_batches(uuid)` (new, private).
- `private.consume_order_item_stock` rewritten to consume from the binding (same public signature).
- `public.transition_delivery` rewritten: `dispatch` branch calls the binder once, guarded by
  `dispatched_at is null` (unchanged otherwise).
- `public.delivery_detail` rewritten: `pick` reads `delivery_item_batches` once `dispatched_at is not
null`, otherwise the existing live preview (unchanged).
- Regenerate `src/types/database.generated.ts` (`npm run db:types`) for the new table.

## Required regression evidence (from the Claude prompt)

New file `tests/integration/deliveries-batch-binding.test.ts`:

1. Two batches, two deliveries of the same line/source; deliver the later-created one first — its
   SALE_OUT batch/quantity matches its own bound note; delivering the other afterwards takes exactly
   the remaining batch; reprint after DELIVERED keeps showing the recorded batch, not a recomputed one.
2. Partial quantities, two source locations: bound batches never cross locations (reuses
   `splitWorld`/`splitOrder` helpers from `deliveries-failed.test.ts`); concurrent dispatch of two
   siblings from the same source only lets one claim the shared tail of a batch (reuses the existing
   DEL-012 concurrency pattern, now also asserting the binding table has no overlapping units and
   `verify_inventory_balances()` stays clean).
3. Allocate while the batch is `ACTIVE`/valid, deactivate it (or let `expiry_date` fall behind
   `business_today()` using a batch expiring today), then dispatch: rejected atomically, reservation
   and balances unchanged, delivery stays `READY`.
4. Dispatch while valid (bind succeeds), then deactivate the bound batch, then deliver: rejected
   atomically, no movement posted, delivery stays `OUT_FOR_DELIVERY`.
5. FAILED → reschedule → redispatch → deliver: same bound batch/quantity as the first dispatch, consumed
   exactly once (extends the existing DEL-012 redispatch test with a binding-table assertion).

Keep all existing `deliveries.test.ts` / `deliveries-failed.test.ts` / `deliveries.ts` unit
cases passing unmodified.

## Bug found and fixed during local validation

`delivery_item_batches.created_at` (and `inventory_movements.created_at`) default to `now()`, which
Postgres freezes for the whole transaction. When a dispatch/deliver call binds or posts more than one
batch for the same delivery line, both rows get an **identical** timestamp, so `order by ...created_at`
is not a deterministic tiebreak between them. The first integration run against a real local reset
caught this (`soldBatches` returned the two batches in the opposite order from `boundBatches`, even
though totals/batches were both correct). Fixed by ordering strictly by the batch's own FEFO key
(`product_batches.expiry_date, manufactured_date`, then `id`) in both `consume_order_item_stock`'s
read of the binding and `delivery_detail`'s dispatched-branch pick list — the same key the binder and
the existing live preview already use — instead of the insertion timestamp. The regression test's own
helpers were updated to sort by batch identity (not `created_at`) for the same reason, since
`inventory_movements.created_at` has the same transaction-time characteristic and is out of scope to
change here. Re-verified after the fix: `npx supabase db reset --local` applies cleanly, `npm run
test:db` (111 pgTAP) and `npm run test:integration` (19 files / 275 tests, including the 6 new
DEL-011 cases) all pass.

## Not in this task

- DEL-005 per-delivery source allocation UI/RPC (RV-06).
- A warehouse-receipt/release workflow for goods that cannot be delivered (RV-05's open decision,
  DEL-012's open decision).
- Any change to FEFO allocation (`reserve_order_stock`) itself.

## Codex review correction (02/10/2026)

The 20261002070000 migration remains **unreleased and local-only**. With coordinator approval, its
preflight is corrected before replacing RPCs: an upgrade refuses historical dispatched deliveries
still in logistics, because their original physical batches were never recorded. It also refuses
completed deliveries whose quantities do not match the original SALE_OUT ledger. This is a release
precondition, not a guessed historical allocation or a new return/reconciliation business workflow.
When completed history is consistent, the migration restores binding rows from its original
SALE_OUT batch/quantity records, with insert audit. No source ledger rows are changed.

Every dispatch now validates the already-bound batches, including FAILED -> READY redispatch.
Inactive/expired original batches reject atomically; bindings are never replaced. Added regression
coverage for upgrade preflight, completed-history restoration, inactive and expired redispatch,
concurrent siblings' actual batch bindings, and authenticated binding visibility/write denial.
Upgrade/expiry fixture SQL runs only in the project's Docker local DB and rolls back all clock,
trigger and fixture changes. Shared DB lease is held through validation and task:finish.

Validation for this attempt is recorded in the new append-only pipeline report. Staging/mobile and
independent final review remain pending; previous Claude reports stay unchanged. A deployment with
in-flight legacy goods is explicitly blocked until their authoritative reconciliation is approved.

### Final review: serialize upgrade with legacy writers

The migration now holds ACCESS EXCLUSIVE locks on deliveries, delivery_items and
inventory_movements throughout preflight, completed-history backfill and RPC replacement in its
single Supabase migration transaction. This also waits for existing legacy SELECT FOR UPDATE
transitions to finish before observing state. New dispatch/delivery/item/ledger writes cannot race
between the preflight and the binding-aware RPC replacement. A local 10-second lock timeout makes
busy upgrade attempts fail safely; release requires a reviewed maintenance window. No lock is
installed in ordinary application requests.

Added a rollback-only completed-ledger mismatch regression: a local historical completed line is
made inconsistent while the SALE_OUT ledger is preserved; full preflight must reject, and rollback
restores the original quantity. Docker startup remains blocked, so this regression and actual
migration serialization remain unverified until the local database can run. No fresh DB reset is
performed outside the required task:finish attempt.

### Correction after the first real database run (03/10/2026, claude attempt)

The Codex review corrections above had never run against a database (Docker was down), and the
first real `supabase db reset --local` failed at this migration:
`ERROR: LOCK TABLE can only be used in transaction blocks (SQLSTATE 25P01)`. The previous
reports that recorded `db reset: fail` attributed it to Docker; with Docker running the actual cause
is the migration itself. The Supabase CLI sends a migration as a pipeline of separate statements,
which PostgreSQL does not treat as an explicit transaction block, so a top-level `LOCK TABLE` is
refused. The statement "Supabase applies this file in one migration transaction" above was not
accurate for the lock statement.

- Fix (same migration, still unreleased/local-only): the lock and the local `lock_timeout`
  (`set_config(..., true)`) now run inside a `DO` block. Statements inside a function are accepted
  in a pipeline and in an explicit transaction alike. The locks are held until the migration's
  transaction ends; that they stay held across the whole CLI pipeline was not independently
  observed (only that the file now applies). The release precondition (a reviewed maintenance
  window, retry after the 10 s timeout) is unchanged.
- The never-run rollback-only regression "refuses completed-history quantity mismatches" failed for
  a fixture reason: it cancelled leftover in-flight deliveries without a `cancelled_reason`, which the
  DEL-012 CHECK constraint refuses before the preflight is reached. The fixture now sets the reason.
  Other fixtures in the file already passed.
- Validation: `supabase db reset --local` applies all 28 migrations; pgTAP 111 pass; integration
  19 files / 282 tests (13 in `deliveries-batch-binding.test.ts`) pass after the fixture fix;
  `npm run db:types` produces no change. Staging, mobile and an independent final review remain
  pending, as does the open warehouse-receipt decision.
