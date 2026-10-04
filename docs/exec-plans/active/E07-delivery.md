# E07: Multi-delivery

Source: IMPLEMENTATION_INFRA_PLAN §E07, TECH_DESIGN §3.19, §3.20, §7, PRD §16/17.
Branch: `feature/DEL-001-deliveries` (stacked on `feature/PAY-001-payments`).

| Task                                      | Status                                                                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEL-001 delivery schema                   | done (`deliveries`, code = order code + `-NN`, never deleted)                                                                                                                                 |
| DEL-002 delivery items                    | done (`delivery_items`; an order can have several deliveries)                                                                                                                                 |
| DEL-003 validate total quantities         | done: trigger under a row lock on the order line; cancelled deliveries free their quantity                                                                                                    |
| DEL-004 delivery builder                  | done, **on the order detail page** (not the order form): the plan needs the order to exist and to be allocated; shows the "unassigned quantity"                                               |
| DEL-005 source location selection         | done (defaults to the order's creation location)                                                                                                                                              |
| DEL-006 delivery state machine            | done: PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED / FAILED; FAILED → READY; PREPARING/READY → CANCELLED; enforced by a DB trigger and the RPC                                            |
| DEL-007..009 today / tomorrow / 7 days    | done: `/deliveries` board (`delivery_schedule`), grouped by day, stock-risk and remaining-amount shown                                                                                        |
| DEL-010 calendar view                     | done as a **month list grouped by day** (next 31 days), not a grid                                                                                                                            |
| DEL-011 dispatch transaction              | done: DELIVERED consumes the reserved stock (SALE_OUT, FEFO) atomically with the status change                                                                                                |
| DEL-012 failed delivery                   | **corrected (review RV-03)**: reason required; goods stay in logistics (`dispatched_at`), deducted from what other deliveries of the same line can take at that source, also after reschedule |
| DEL-013 reschedule                        | done: FAILED → READY on a new date; open deliveries can be moved too                                                                                                                          |
| DEL-014 / DEL-015 delivery and issue note | done: `/deliveries/:id/print`, `/deliveries/:id/issue` (pick list in FEFO order, a slice per delivery)                                                                                        |

## Invariants proven by tests

- The sum over non-cancelled deliveries of an order line can never exceed the ordered quantity (two concurrent plans: exactly one wins).
- Stock moves only when the goods are DELIVERED, through `post_inventory_movement` (movement carries `delivery_id`); `verify_inventory_balances()` is clean afterwards.
- A delivery cannot go out unless enough stock is allocated (reserved) for the order at its source location.
- Deliveries are never deleted (even by the service role); they cannot be written directly by any client role.
- The order follows its deliveries: RESERVED → PREPARING (a delivery exists) → WAITING_DELIVERY (one is READY/OUT) → COMPLETED when everything is delivered **and** the remaining amount is zero. The payment that pays the last VND also completes an already fully delivered order.

## DEL-012 correction (review RV-03), migration `20261002060000_delivery_failed_logistics.sql`

TECH_DESIGN §7: a FAILED delivery does not return stock; the goods follow the logistics state until the warehouse takes them back.

- Before: only OUT_FOR_DELIVERY deliveries were deducted from the stock reserved at the source. A FAILED delivery (or a FAILED one rescheduled to READY) made its goods look available, so order 10 (X: 5, Y: 5) with A from X failed could dispatch B from X with the same 5 units.
- Now: `deliveries.dispatched_at` is written by the first dispatch only (DB trigger, immutable, also for the service role). A delivery with `dispatched_at` and a status other than DELIVERED/CANCELLED has its goods in logistics; its units are deducted from the reserved quantity that every other delivery of the same order line can take at the same source (`private.delivery_logistics_qty`, used by `assert_delivery_stock`). The deliveries of one order are serialised by the order row lock taken in `transition_delivery`.
- Nothing is released implicitly: FAIL and RESCHEDULE touch no reservation or balance. The single PHYSICAL_ALLOCATION reservation is consumed once, at DELIVERED (redispatch of the same delivery never double counts).
- A delivery whose goods left the warehouse cannot be cancelled (RPC and trigger) and its source location cannot change.
- The board shows `goods_in_logistics`; `stock_risk` is now net of goods other deliveries hold in logistics.
- **Open decision (blocker for a business owner):** returning goods of a failed delivery to the warehouse ("kho nhận lại") is not specified anywhere (no state, ledger movement or role; E10 covers customer returns only). No release path was invented. Until it is specified such a delivery can only end by being delivered; if the customer refuses, the units remain reserved at that source.
- Not in this task: batch/pick binding when deliveries are confirmed out of order (RV-04 / DEL-011), batch expiry re-check (RV-05), allocation per source UI (DEL-005).

## Decisions (docs silent; flag if wrong)

- Delivery methods: `CHB_DELIVERY` (CHB tự giao), `THIRD_PARTY` (đơn vị vận chuyển), `CUSTOMER_PICKUP` (khách tự đến lấy). No courier integration (PRD).
- Stock is consumed at DELIVERED, not at dispatch. OUT_FOR_DELIVERY keeps the reservation, so a FAILED delivery needs no stock correction.
- Allocation (RESERVED) is the gate: planning is allowed earlier, but ready/dispatch/deliver need the order to be RESERVED or later.
- Who: Admin or the order owner/creator plans and cancels; Admin or Warehouse prepare, dispatch, deliver, fail and reschedule. Sales roles see only deliveries of their own orders.
- A delivery cannot be edited after READY (cancel and re-plan, or reschedule). The date must be today or later when creating.
- The delivery builder lives on the order detail page, the calendar is a list (no grid), and shipping fee is informational (not added to the order total).
- Not done: RES-005's automatic allocation by delivery date (the `allocate_order` primitive exists; Admin runs it from the order page).

## Validation log

- lint, typecheck, format:check, unit (163), build pass. Integration: deliveries 16 tests, full suite re-run below. pgTAP unchanged (111).
- Browser (sale and warehouse, local): board lists deliveries by day with status, edit and cancel dialogs open (cancel demands a reason), issue note prints with batch and HSD.
- Not manually checked: phone layout, the dispatch/deliver buttons in the browser (covered by integration tests).
