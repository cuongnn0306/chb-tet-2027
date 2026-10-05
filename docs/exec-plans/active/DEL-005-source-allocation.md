# DEL-005: phân bổ hàng theo từng đợt giao / từng kho xuất (review RV-06)

Source: `docs/reviews/2026-10-02-project-review.md` RV-06, PRD §16, TECH_DESIGN §3.19/§3.20/§5.2/§7,
`docs/handoff/claude-inbox/DEL-005-source-allocation-20261003.md`. Branch `feature/DEL-012-failed-logistics`
(stacked on DEL-012 and DEL-011, per AUTOMATION_STATE assignment).

## Dependency evidence

| Dependency                                   | Evidence read before coding                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEL-001..004 deliveries, items, builder      | `20261001200338_deliveries_schema.sql`, `save_delivery` records `source_location_id` per delivery; sum of delivery items ≤ ordered quantity is enforced |
| DEL-006 state machine, SALE_OUT at DELIVERED | `transition_delivery` (binding migration): stock is consumed only at `deliver`                                                                          |
| DEL-012 goods in logistics                   | `private.delivery_logistics_qty`, `dispatched_at`; FAILED goods stay reserved                                                                           |
| DEL-011 batch binding                        | `delivery_item_batches`, `private.bind_delivery_item_batches` (replaced additively here, see below)                                                     |
| RES-007/008 FEFO allocation                  | `private.reserve_order_stock` / `public.allocate_order`: whole order at **one** location, only while CONFIRMED                                          |
| Local DB pipeline                            | INF-008 root pipeline passed; DEL-011 report `2026-10-03T13-35-53` DB reset, pgTAP and integration passed                                               |
| DEL-005 first attempt validation             | `docs/handoff/reports/DEL-005-2026-10-03T18-30-17-742Z.md`: all checks passed (DB reset, pgTAP, integration) except `format:check` on 3 DEL-005 files   |

## Problem (RV-06)

`allocate_order` allocates `quantity - allocated_quantity` of the whole order at one location and only for a
CONFIRMED order. A delivery planned from another warehouse, planned after the order moved on, or planned after a
partial delivery had no way to reserve stock at its own source; re-running the order-wide allocation would have
re-reserved already delivered quantity. Warehouse staff had no allocation UI at all.

## Decision (additive migration `20261003080000_delivery_source_allocation.sql`)

No existing RPC contract, table or migration is changed (the DEL-011 migration is untouched).

- `delivery_stock_allocations` (append-only, gated like reservations): units reserved _for_ a delivery at a location.
- `allocate_delivery_stock(delivery, allow_below_safety)` (Admin/Warehouse; safety stock Admin only): reserves exactly the
  **gap** of one delivery at its source, FEFO, all-or-nothing. A shortage returns the shortage and changes nothing.
  Locks delivery then order (same order as `transition_delivery`), so repeated/concurrent calls reserve once.
- Accounting per (order line, location): `reserved` units, `claims` of open deliveries, `attributed` units, and an
  unattributed **pool** (the order-wide allocation) that covers open deliveries in priority order (goods in logistics
  first, then date/time/creation). The gap is `claim - attributed - pool share`, so an order fully allocated at its
  creation location still covers deliveries from there and nothing is reserved twice.
- Units the order holds at **other** locations beyond `quantity - delivered_quantity` are released (reverse FEFO, never
  units an open delivery there needs, never a batch bound to goods in logistics). Delivered history is never touched
  and the full ordered quantity is never re-reserved.
- A CONFIRMED order whose lines are all covered moves to RESERVED, as `allocate_order` does (state machine unchanged).
- `delivery_allocation_status(delivery)` gives the screen coverage, shortage + transfer suggestion
  (`stock_check_lines`) and holds at other locations.
- Audit: reservation rows (existing trigger, with reason), the new attribution rows, and one explicit
  `audit_logs` row (`deliveries`, `allocate_stock`).
- `private.bind_delivery_item_batches` is replaced (same signature) to bind by free quantity per batch instead of queue
  position. Reason: allocation after a sibling already left the warehouse can add an earlier-expiring batch, which
  shifts the positional offset and double-books a batch bound to goods in logistics. Result is identical whenever the
  queue only shrank; contract and sellability checks are unchanged. Covered by a regression.

### Correction attempt: coverage cap (migration `20261004090000_delivery_allocation_coverage_cap.sql`)

Found by review: a PREPARING delivery can change source or quantity through `save_delivery`. The append-only
attribution kept counting as coverage after its reservation was released (allocate at A, edit source to B,
allocate B which releases A's surplus, edit back to A: status said "covered" while nothing was held at A, the
allocate button stayed hidden and only the dispatch gate stopped the goods).

`private.delivery_stock_coverage` is replaced (same signature; the 080000 migration and the attribution history
are untouched): attribution counts only up to the delivery quantity and only while units are actually reserved at
the location, handed to open deliveries in the existing priority order. Quantity edits follow the same rule:
raising a quantity leaves only the difference as the gap; lowering it keeps the extra units reserved (they cover a
sibling delivery from the same source or are released as surplus by a later allocation elsewhere). No new state or
role policy.

Files kept from the first attempt after scope review: the actual migration name `20261003080000_...`, the plural
test name `deliveries-source-allocation.test.ts`, and the `OrderDetailPage.tsx` allocation button wiring.

## UI

`DeliveryAllocationDialog` (shared Dialog/Button/state components, Vietnamese, buttons `min-h-11`): opened from
"Phân bổ hàng" on a delivery in the order detail panel and on the delivery board, for Admin/Warehouse only, for
PREPARING/READY deliveries. Sales never see it. Pure rules in `src/domain/deliveries/deliveries.ts`.

## Tests

- `tests/integration/deliveries-source-allocation.test.ts`: one SKU split over two warehouses; order-wide allocation
  moved to the second source without double reservation; shortage at one source changes nothing; partial DELIVERED then
  allocation of the remaining source (delivered history and SALE_OUT untouched); repeated and concurrent allocation;
  out-of-order batch binding; Admin/Warehouse only, safety stock Admin only; audit and immutability.
  Correction attempt adds: source edit A -> B -> A (status must not report coverage, allocation re-reserves at A and
  takes the surplus back from B, then delivers from A) and quantity edits (raise reserves only the difference,
  lower keeps pooled units that cover a sibling delivery).
- `tests/unit/domain/deliveries.test.ts`: `canAllocateDelivery`, `allocationOutcomeMessage`.

## Not in this task / open decisions

- RES-005 automatic lead-time allocation is not implemented; allocation stays a manual Admin/Warehouse action.
- `assert_delivery_stock` (dispatch gate) is unchanged: it still checks the pooled reservation at the source net of
  goods in logistics, not the per-delivery attribution. A delivery that was not allocated can still dispatch while the
  pool covers it; the per-delivery coverage is advisory in the UI and enforced by the allocation RPC. Tightening the
  gate would change an existing RPC contract and needs a decision.
- Expired/deactivated dispatched stock and goods returned after a failed delivery (RV-05 / DEL-012 open decisions) are
  not changed.
- `src/types/database.generated.ts` is **not regenerated and is a known blocker for the coordinator**: `task:finish`
  has no generation hook under the shared DB lease, and neither direct generation commands nor hand edits are
  allowed for this task. The coordinator must arrange pipeline-owned generation separately after the migrations
  are applied. Until then the new RPCs/table are called through the existing untyped RPC helper, so the build does
  not depend on it.

## Status

First attempt: validated locally (report `DEL-005-2026-10-03T18-30-17-742Z`, `needs_validation`): lint, typecheck,
unit, build, env, `supabase db reset`, pgTAP and the full integration suite passed; `format:check` failed on the
three DEL-005 files (fixed in the correction attempt). The first-attempt report and plan text written before that
run said "not validated"; the immutable report keeps that wording, this section supersedes it.

Correction attempt: the coverage-cap migration and the A -> B -> A / quantity-edit regressions are validated only
by the report of this attempt. Staging, browser/mobile and independent review remain pending. Not Done.
