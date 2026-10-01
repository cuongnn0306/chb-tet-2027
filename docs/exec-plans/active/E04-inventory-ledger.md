# E04 — Inventory Ledger & Batch

Source: IMPLEMENTATION_INFRA_PLAN §E04, PRD §10–§13, TECH_DESIGN §3.8, §3.11–§3.12, §5.1.
Branch: `feature/INV-001-batches-ledger` (stacked on `feature/CUS-005-customer-history`).

| Task                                       | Status                                              |
| ------------------------------------------ | --------------------------------------------------- |
| INV-001 batch schema                       | done (+ create-batch UI for Admin/Warehouse)        |
| INV-002 inventory movement schema (ledger) | done                                                |
| INV-003 balance projection/cache           | done                                                |
| INV-004 no-negative transaction function   | done (`private.post_inventory_movement`, row locks) |
| INV-005 initial stock manual entry         | done (Admin)                                        |
| INV-006 initial stock Excel import         | pending                                             |
| INV-007 inventory summary                  | done (all roles; sales see only "Có thể bán")       |
| INV-008 inventory batch detail             | done (Admin/Warehouse/Production)                   |
| INV-009 inventory movement history         | done (Admin/Warehouse)                              |
| INV-010 manual adjustment                  | done (Admin + mandatory reason)                     |
| INV-011 sample / gift / damage flows       | done (Admin/Warehouse + reason)                     |

## How integrity is guaranteed (acceptance E04)

- `inventory_movements` is immutable and the source of truth; `inventory_balances` is a cache.
- Only `private.post_inventory_movement()` writes either table. Guard triggers refuse every other writer — clients, the service role, a manual Studio edit — for balances (UPDATE/INSERT/DELETE) and for the ledger (INSERT/UPDATE/DELETE/TRUNCATE).
- Negatives are impossible: all quantity columns are CHECK >= 0, `reserved <= available`, and the function refuses to take more than `available - reserved` with a clear message. Rows are locked in a fixed order, so concurrent takers of the last unit are serialised (tested: 2 racers -> 1 winner; 12 racers for 3 units -> 3 winners).
- `verify_inventory_balances()` (Admin) recomputes the six ledger-derived counters and returns only mismatches; tampering is detected (pgTAP).

## Decisions (docs silent; flag if wrong)

- Batch `status`: `ACTIVE` / `INACTIVE` (docs only say "status"); INACTIVE batches stay physically counted but are not sellable. A batch cannot be deleted; its product/code/dates freeze once stock has moved.
- Movement direction comes from the type (quantity is always positive). Transfer effect: `TRANSFER_OUT` removes from source available and shows as in-transit at the destination; `TRANSFER_IN` moves in-transit to available (E08 will drive these). `DAMAGE_OUT`/`SAMPLE_OUT`/`GIFT_OUT` move available into their own counters. `RETURN_IN` goes to pending inspection (not sellable); inspection moves it to available or damaged.
- Opening stock is `ADJUSTMENT_IN` with a fixed "Tồn đầu kỳ" reason (the movement list has no opening type).
- Sellable (summary) = (available − reserved) of ACTIVE, non-expired batches − safety stock, floored at 0; expired stock is reported separately.
- Visibility: batch tables and balances for Admin/Warehouse/Production; ledger for Admin/Warehouse; every active role sees the summary function (no batch detail for sales).
- `reserved_qty` is not derived from movements (reservations arrive with E05), so reconciliation does not compare it.

## Validation log

- lint, typecheck, unit (112), build pass. pgTAP `npm run test:db`: 44 assertions (all 12 movement types, validation, guards, CHECK constraints, reconciliation + tamper detection). Integration: 163 tests (22 for inventory) stable on two runs; also added `test:db` to CI.
- Browser-verified as Warehouse: navigation limited to Tồn kho / Tồn theo lô / Lịch sử kho, only permitted actions, damage exit with consequence text, over-take refused with an actionable message, valid exit updates available/damaged, ledger entry with actor and reason, summary with detail columns.
- Not manually checked: Admin-only dialogs (opening stock, adjustment, reconciliation) in the browser (covered by integration tests); the simplified sales summary view; phone layout.
