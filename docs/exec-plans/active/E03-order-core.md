# E03 — Order Core

Source: IMPLEMENTATION_INFRA_PLAN §E03, PRD §7, §19, §21, §25/B11, TECH_DESIGN §3.9–3.10, §6.
Branch: `feature/ORD-001-orders-schema` (stacked on `feature/CUS-001-customers`).

| Task                                                                                | Status                                                                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ORD-001 orders / order_items schema (+ status history)                              | done                                                                                                                  |
| ORD-002 order code generator (`TET000123`, server-side, prefix from `order_prefix`) | done                                                                                                                  |
| ORD-003 order items with list-price snapshot                                        | done                                                                                                                  |
| ORD-004 pricing calculator (gross / discount / net)                                 | done: SQL (authoritative) + `src/domain/orders/pricing.ts` (UI preview), parity-tested                                |
| ORD-005 discount <= base commission                                                 | done: COM-001 priority resolution implemented in SQL (`private.resolve_commission_rate`) because the ceiling needs it |
| ORD-006 create draft order                                                          | done (`save_draft_order` RPC + `/orders/new`, `/orders/:id/edit`)                                                     |
| ORD-007 submit order                                                                | done (`transition_order('submit')`)                                                                                   |
| ORD-008 state transition service                                                    | done: DB trigger enforces the full machine for every caller; RPC exposes only user actions                            |
| ORD-009 cancel logic                                                                | done (release of temporary reservations is added by E05: reservations do not exist yet)                               |
| ORD-010 void (Admin)                                                                | done: reason required, soft-delete semantics, audited                                                                 |
| ORD-011 order list                                                                  | done                                                                                                                  |
| ORD-012 order detail                                                                | done                                                                                                                  |
| ORD-013 order timeline                                                              | done (`order_status_history`, immutable)                                                                              |
| ORD-014 print order                                                                 | done (print layout; header hidden when printing)                                                                      |

## Invariants proven by tests

- Orders/items cannot be written by clients at all; only validated RPCs write them.
- After DRAFT: customer, attribution, lines, quantities, prices and amounts are frozen (DB triggers, also against the service role).
- Orders and history are never hard-deleted; history is immutable; every status change is recorded with actor and reason.
- Server computes gross/net from `products.list_price`; client-supplied prices are ignored.
- The status machine in the DB equals `src/domain/orders/state-machine.ts`.

## Decisions (docs are silent; flag if wrong)

- Visibility follows the matrix: sales roles see orders they own or created; Admin sees all; Warehouse/Production none (they get demand/delivery views in later epics). PRD §3.3 mentions "đơn của mình/cơ sở" for store staff; implemented as "mine" per the matrix.
- Order code is assigned when the draft is created. If `order_prefix` is not configured, creating an order fails with a clear message instead of using an invented default.
- Discount ceiling: base commission = floor(sum(gross_line x rate / 100)); rates resolved at the Vietnam business date with COM-001 priority (User+Product, User, Role+Product, Role, product default); the same-priority tie-break is latest `effective_from`, then latest `created_at`. The ceiling is re-checked at submit because rates can change.
- No admin override of the discount ceiling (PRD: "không cho lưu đơn").
- Who can do what: owner/creator submit, return to draft (while unpaid) and cancel (Draft / Waiting confirmation / Waiting deposit); Admin confirms, voids and is the only one who can cancel Confirmed/Reserved orders. A reason is required for cancel and void.
- Cancel/void/return-to-draft are blocked once `paid_amount > 0` until payment refund/void exists (E06 / PAY-010), so money is never orphaned.
- `deposit_required`, deposit-driven `CONFIRMED`, reservations and later statuses are driven by their own epics (E05/E06/E07); they are not user actions here.
- `remaining_amount` is a generated column (`max(net - paid, 0)`), so it cannot disagree with the amounts.
- Added `orders.cancel_reason` (additive to the spec) so reports can use it without parsing audit logs.
- Delivery builder in the order form (DEL-004) is E07, so the E03 form has no delivery section.

## Validation log

- lint, typecheck, unit (97), build pass; integration 137 tests (36 for orders), stable on two runs.
- Browser-verified as Sale B2B: default-filled attribution, customer search (unaccented), live discount ceiling (54.000 ₫ for HQ-A at 12%), over-ceiling message, save + submit, generated code, detail, timeline, cancel dialog (consequence + required reason), list + code search, print page.
- Not manually checked: phone viewport layout (cards on phones are implemented), Admin confirm/void in the UI (covered by integration tests), actual printing.
