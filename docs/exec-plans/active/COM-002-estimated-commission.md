# COM-002 — Estimated commission and first-confirmation snapshot

## Scope and dependencies

Implementation plan E11 COM-002: commission is an **estimate** until the order is first CONFIRMED; at that first transition the
per-line rate, rule evidence and seller/role basis are frozen so later rule or role changes never rewrite the order
(PRD §19.1–19.4, TECH_DESIGN §12 commission state machine, discount allocation clause).

Depends on COM-001 (priority resolver, `private.resolve_commission_rate`, covered by `supabase/tests/commission_resolution.test.sql`),
ORD-005 (discount ceiling) and the order/deposit state machine (E03/E06). Starts from the COM-001 reviewed checkpoint `3f5ef40`
(COM-001 is `needs_validation`, not Done).

Out of scope: COM-003 eligibility (`ELIGIBLE`), COM-004/005 deductions and return adjustments, COM-008 finalization, the
`commission_entries` table, any UI. The order form already labels the figure "Hoa hồng bạn nhận (dự kiến)", so no screen changed
(no mobile impact).

## Design

New migration `20261016090000_com002_commission_snapshot.sql` (no applied migration was edited):

- `private.resolve_commission_rule(user, product, date)` returns the rate **and its evidence** (`USER_PRODUCT`, `USER`, `ROLE_PRODUCT`,
  `ROLE`, `PRODUCT_DEFAULT`, `NONE`, rule id, period). `private.resolve_commission_rate` now delegates to it, so there is one
  implementation of the COM-001 priority.
- `private.order_commission_basis(order, date)` computes every line: commission revenue = list price × quantity, base commission,
  customer-discount share. Used by both the estimate and the snapshot, so they cannot disagree.
- `public.order_item_commission_snapshots`: one immutable row per order item (rate, rule evidence, `resolved_on`, seller user,
  seller role id/code, revenue, base, discount share, generated `final_commission`). Update/delete/truncate are blocked by triggers
  (also for the service role), clients have no write grants, creation is audited. RLS: Admin only, because the rows carry rule
  evidence; salespeople read their own figures through the RPC.
- AFTER UPDATE trigger on `orders` (`WHEN new.status = 'CONFIRMED' AND old.status IS DISTINCT FROM 'CONFIRMED'`) calls
  `private.snapshot_order_commission(order)`, in the same transaction as the status change. It covers both paths into CONFIRMED
  (deposit paid, and a zero-deposit Admin confirmation). `ON CONFLICT (order_item_id) DO NOTHING` makes it idempotent.
- `public.estimate_order_commission(order)` (SECURITY DEFINER, Admin or the order's owner; unknown and forbidden orders answer
  identically with 42501). `basis`: `SNAPSHOT` (frozen), `ESTIMATE` (never confirmed, today's rules), `MISSING_SNAPSHOT`
  (confirmed before this migration: nothing is invented from today's rules, no backfill). Rule id/period are returned to Admin only.
- TypeScript: `src/domain/orders/commission.ts` (`commissionBreakdown`, the reference of the SQL rounding for previews and parity
  tests) and `orders.service.ts#commissionEstimate` with typed `OrderCommissionEstimate`.

### Rounding (the specs require a fixed, total-preserving rule but do not name one)

Largest-remainder allocation, integer arithmetic only:

- base commission: line weight = `gross_line × rate×100`; each line gets `floor(weight / 10000)`; the order target is
  `floor(Σ weight / 10000)`, which equals the ORD-005 discount ceiling; the leftover units go one each to the largest remainders;
- discount share: line weight = `discount × gross_line`; each line gets `floor(weight / Σ gross)`; leftover to the largest remainders,
  so Σ shares equals the order discount exactly;
- ties: lower SKU in byte order (`COLLATE "C"`, independent of the database locale), then lower item id.

## Decisions to confirm (not invented policy, but the specs are silent)

1. **Snapshot moment.** The task text and TECH_DESIGN say "first transition to CONFIRMED". In this codebase the Admin's
   `confirm` action moves the order to `WAITING_DEPOSIT`; `CONFIRMED` happens when the deposit is covered (or immediately with a
   zero deposit). The snapshot follows the status literally, so rates changed between the Admin's confirmation and the deposit still
   apply. If the Owner means the Admin's click, the trigger condition changes to `WAITING_DEPOSIT`.
2. **Discount above the base commission at confirmation.** A rate cut after the draft was saved can leave the discount above the
   base commission (PRD §19.3 rejects this at save/submit; ORD-005 re-checks at submit only). The snapshot never raises, because that
   would roll back a payment that already arrived; it records honest figures and `estimate_order_commission` reports
   `discount_within_base_commission = false`. What to do with such an order (re-check at Admin confirmation, cap, or Admin exception)
   is a policy for the Owner / COM-003.
3. A line can have a negative `final_commission` when a 0% line carries part of the order discount; only the order total is
   guaranteed non-negative while the discount is within the ceiling.
4. `commission_entries` (TECH_DESIGN §3.23) is deliberately not created here; COM-003 owns the order-level lifecycle.

## Acceptance evidence

Test files: `supabase/tests/commission_snapshot.test.sql` (pgTAP), `tests/integration/commission-snapshot.test.ts`, `tests/unit/domain/order-commission.test.ts`.

- Estimate before confirmation follows today's rules (create, change, deactivate a rule): pgTAP order 1; integration "stays an estimate".
- Snapshot of rate, evidence and seller/role at the first CONFIRMED, atomic with the status change: pgTAP orders 1–3; integration deposit path and zero-deposit path.
- Repeated confirmation / idempotency: pgTAP calls `private.snapshot_order_commission` again (returns 0, rows unchanged); a cancelled order cannot re-enter CONFIRMED.
- Later rule, role and product-default edits do not rewrite an order: pgTAP compares the row set with a copy taken before the edits (`EXCEPT`); integration edits the rate, adds a newer rule and deactivates the old one.
- Integer rounding and discount conservation: unit tests (fixed cases, tie-breaks, 300 random orders), exact pgTAP values, integration TypeScript-vs-database parity and equality with the `quote_order` ceiling.
- Permissions / RLS: seller, another seller, Warehouse, unknown order, Admin; no client write; no service-role rewrite or delete.
- Unchanged order behaviour: pgTAP checks quantities stay immutable, orders are not hard-deleted, cancelling keeps the snapshot, order amounts are untouched.
- Generated types: `task:finish --generate-types` regenerates `src/types/database.generated.ts` from the local stack.

Pass/fail of each check is recorded only in the immutable report written by `npm run task:finish -- COM-002 ...`.

## Generated-type handoff

`src/types/database.generated.ts` was regenerated by `task:finish --generate-types` (report `COM-002-2026-10-17T06-28-40-799Z`) and now contains
`estimate_order_commission` and `order_item_commission_snapshots`. The temporary `EstimateRpcClient` bridge in `orders.service.ts` was removed;
`commissionEstimate` calls the generated RPC and only converts the `Json` return to `OrderCommissionEstimate`, using the same `as never` /
`call(...)` pattern as `quote`. Runtime error handling is unchanged. No migration, business rule or test behaviour changed.

## Open Owner decisions (unchanged, not Done)

Snapshot moment (first `CONFIRMED` vs. the Admin click), a rate cut leaving the discount above the base commission, and negative per-line
commission / rounding policy. Mobile, staging, current-head CI and Owner acceptance are still pending.

## Limits

No UI was changed, so there is no browser or mobile verification. No staging, remote CI or Owner acceptance has happened; the
decisions above need Owner review before COM-003 builds on the snapshot.
