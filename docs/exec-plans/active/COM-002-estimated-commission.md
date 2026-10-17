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

## Earlier open decisions (history; resolved by the Owner on 17/10/2026 — see the next section)

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

## Owner decision 17/10/2026 (authoritative; `docs/product/OWNER_DECISIONS_2026-10-17.md`)

Spec text updated: PRD §19.3–19.4, TECH_DESIGN §12, implementation plan COM-002/COM-003. The previous wording (11/10) is quoted in those files.
New migration `20261017090000_com002_discount_exception.sql`; `20261016090000_com002_commission_snapshot.sql` and historical reports are untouched.

1. **Snapshot moment**: the actual first `CONFIRMED` transition (kept; the trigger fires on `status` becoming `CONFIRMED`). A rate cut between
   `WAITING_DEPOSIT` and the paying transaction is therefore frozen. Regression: pgTAP order `ox`, integration "confirms and posts the payment once".
2. **Discount above base commission at `CONFIRMED`**: the order confirms and the payment stays posted once (the snapshot trigger never raises).
   `commission_discount_exceptions` (one row per order, `PENDING`) locks the commission: `private.commission_is_locked(order)` is the gate COM-003 must
   check before any `ELIGIBLE` transition. `approve_commission_discount_exception(order, reason)` is Admin-only, needs a nonblank reason, takes a row lock
   (`FOR UPDATE`), writes exactly one `UPDATE` audit entry carrying the reason, and is idempotent (a repeat returns `already_approved = true`, no second audit).
   Nothing is auto-approved. Table: Admin-only SELECT (the reason is Admin data); no INSERT/UPDATE/DELETE grant for any API role (also not `service_role`);
   a guard trigger only allows `PENDING → APPROVED` with the figures unchanged and blocks delete/truncate. The seller sees status and excess through the RPC, never the reason.
3. **Nonnegative payable commission**: every snapshot line keeps three separate figures — `customer_discount_share` (unchanged, for returns), the new
   `commission_deduction` (0..base) and `payable_commission = base − deduction`. Order level: `discount = Σ deduction + company_borne_excess` exactly;
   `Σ payable = base − min(discount, base)`; with a discount above the base the employee gets 0 and the company bears the positive excess.
   The legacy `final_commission` column (base − share) is kept, commented as non-payable, and never used for payout.

### Deterministic allocation (identical in `src/domain/orders/commission.ts` and `private.order_commission_basis`)

1. base per line and discount share per line: unchanged largest-remainder rules.
2. `F = min(discount, Σ base)`; start `own_i = min(share_i, base_i)`; `remaining = F − Σ own`; `room_i = base_i − own_i` (so `remaining ≤ Σ room`).
3. spread `remaining` over `room` with weights `remaining × room_i / Σ room`: floors first, leftover units to the largest remainders. A remainder is positive for
   every line that receives a leftover unit, so no line exceeds its room.
4. Tie-break everywhere: lower SKU in byte order (`COLLATE "C"`), then lower order-item id; independent of the input order and of the database locale.
   Worked example: 33.333 / 30.003 / 6.993 at 7,5 % / 12,34 % / 0 %, discount 5.000 → shares 2.370 / 2.133 / 497, base 2.500 / 3.702 / 0, `own` 2.370 / 2.133 / 0,
   `remaining` 497 over rooms 130 / 1.569 / 0 → +38 / +459 → deduction 2.408 / 2.592 / 0, payable 92 / 1.110 / 0 (Σ 1.202). After a cut to 1 % on the first line the base is
   333 / 3.702 / 0 = 4.035, payable 0 / 0 / 0, company-borne excess 965.

### Legacy snapshots (`allocation_version = 1`)

Rows written by the earlier allocation are not rewritten (the immutability trigger stays). They carry `allocation_version = 1` with NULL `commission_deduction` /
`payable_commission`; the estimate RPC reports them as stored (`final_commission` = the old difference, payable and excess NULL) and never recomputes them. Version 1 rows
exist only in local development databases (the first migration was never applied to a shared or production database). Whether a legacy row could ever become payable
is a COM-003 / Owner question and is not decided here.

### Tests (all DB checks run only inside `task:finish`)

- unit `tests/unit/domain/order-commission.test.ts`: reconciliation invariants, 0 % lines, exact ceiling, excess, tie-breaks (shares and deduction spread), large integers, 400 random orders including discounts up to 1.5 × the base;
- pgTAP `supabase/tests/commission_snapshot.test.sql`: authoritative SQL allocation for the same fixtures, rate cut between `WAITING_DEPOSIT` and payment-driven `CONFIRMED`, payment posted once, one snapshot, pending lock, non-Admin refused, blank reason refused, audited approval, idempotent repeat, immutability and least-privilege/RLS, ordinary orders without exception, full discount in order amounts, legacy rows;
- integration `tests/integration/commission-snapshot.test.ts`: TypeScript-vs-database parity of deduction/payable, the whole exception flow through the API including two concurrent approvals (exactly one audit entry), and exception-table access by every API role.

### UI gate

Review fix (P1 + P2). The order detail page now has an Admin approval action:

- `CommissionExceptionPanel` (container: `commissionEstimate` query, `approveCommissionException` mutation, refreshes the estimate) renders `CommissionExceptionView` (pure props, fixture-renderable) for the Admin and the order's own salesperson; other roles never mount it.
- The view shows, in accented Vietnamese: the frozen base commission, the customer discount, the company-borne excess, the employee payable commission and the lock status. For the Admin it also has a required reason field, the consequence text (approval unlocks the commission; the company bears the excess; the employee payout cannot go below zero; audited, irreversible) and the button “Duyệt ngoại lệ và mở khóa hoa hồng”. A salesperson sees the figures and the lock but no field, no button and never the reason (the RPC returns `approval_reason` null to them, and the view refuses to print it for non-Admin).
- `submitApproval` (feature logic) validates a nonblank reason before calling, sends the trimmed text, reports a repeat or a concurrent approval (`already_approved`) as a calm “already approved” message and maps failures through `describeDbError` (42501, P0002). The rules themselves stay in the RPC: Admin-only, nonblank reason, row lock, one audit entry, idempotent.
- States covered: loading, empty (“Không có ngoại lệ chiết khấu”), error with retry, no permission (RPC 42501), pending, approved, busy, validation error, failed approval. Orders not yet CONFIRMED, or without a frozen snapshot, render nothing.
- Narrow screens: labels wrap (`break-words`), the figures use a two-column grid, the field is full width and the button is `w-full sm:w-auto` with 44 px touch height. `tests/unit/features/commission-exception.test.ts` guards those classes only; **no real phone/browser QA was done**.
- Evidence: that unit file (fixture data only, `renderToStaticMarkup` in the node test environment, because the repository has no DOM test library) covers pending → approved, the role boundary, the reason being Admin-only, validation, repeat and error outcomes. The DB behaviour behind the action is proven by the existing pgTAP and integration tests.
- P2: the temporary `ApproveRpcClient` cast and interface are removed; `approveCommissionException` calls the generated typed `client.rpc('approve_commission_discount_exception', …)` with the same narrow `as never` / result-type conversion as `quote`. Behaviour is unchanged.

## Still pending (not Done)

COM-003 eligibility lifecycle (must honour `commission_is_locked` and consume `payable_commission`, not the legacy `final_commission`), COM-005 return adjustments using `customer_discount_share`, real mobile/browser QA of the approval panel, staging, current-head CI, Owner acceptance and Codex re-review.

## Limits

No staging, remote CI, real-device QA or Owner acceptance has happened.
