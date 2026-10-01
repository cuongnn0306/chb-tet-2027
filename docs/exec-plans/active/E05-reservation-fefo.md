# E05 — Reservation, FEFO, Allocation

Source: IMPLEMENTATION_INFRA_PLAN §E05, PRD §8, §9, §12–§14, TECH_DESIGN §3.13, §5.2, §5.3, §6.3–6.5.
Branch: `feature/RES-001-reservations` (stacked on `feature/INV-006-opening-stock-import`).

| Task                              | Status                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RES-001 temporary reservation     | done: taken by a DB trigger when an order enters WAITING_DEPOSIT (Admin confirm)                                                                                                                                  |
| RES-002 reservation TTL setting   | done: `reservation_ttl_hours` (MD-007); if not configured, confirming fails with a clear message instead of a hidden default                                                                                      |
| RES-003 auto expiry job           | done: `private.expire_temporary_reservations()` via pg_cron every minute (guarded: migration still applies without pg_cron), run lazily before every new reservation, Admin tool `release_expired_reservations()` |
| RES-004 demand commitment         | done: CONFIRMED orders release their temporary hold and count in `committed_demand()` (Admin/Warehouse/Production)                                                                                                |
| RES-005 allocation lead time      | setting `allocation_lead_days` exists (MD-007); the delivery-date driven job that uses it needs deliveries → **E07**. `allocate_order()` is the primitive it will call                                            |
| RES-006 FEFO engine               | done (earliest expiry, then manufacture date; ACTIVE + non-expired batches only)                                                                                                                                  |
| RES-007 physical allocation       | done: `allocate_order` (Admin/Warehouse); full allocation moves CONFIRMED → RESERVED                                                                                                                              |
| RES-008 multi-batch allocation    | done                                                                                                                                                                                                              |
| RES-009 shortage signal           | done: `order_stock_status`, `check_stock` (order form warning), UI panel and warning                                                                                                                              |
| RES-010 suggested source location | done: priority same region → enough quantity → earlier expiry → more stock; reused by transfers (TRF-002)                                                                                                         |

## Invariants proven by tests

- A hold never exceeds `available − reserved`, and (unless the Admin override is used) never dips into safety stock; expired and INACTIVE batches are never allocated.
- `reserved_qty` is derived from ACTIVE reservations and only changes inside the engine (guard trigger, same flag as stock movements); reservations cannot be edited or deleted directly; `verify_inventory_balances()` now also compares `reserved_qty` to the reservations (drift is detected).
- Concurrency: 3 orders confirmed at once for 5 units hold exactly 5 (2/3/0 split); a hold racing a stock exit never exceeds the stock.
- Cancel/void release every hold (temporary and physical) and reset `allocated_quantity`; expiry releases holds but leaves the order in WAITING_DEPOSIT.

## Decisions (docs silent; flag if wrong)

- Holds are best-effort: the Admin can always confirm an order; if stock is short the order holds what is sellable and the shortage is shown with a source suggestion (PRD "có thể giữ tồn tạm", no blocking).
- A temporary hold is taken at the order's creation location (delivery source selection is E07). Physical allocation also defaults to the creation location; `p_location_id` overrides it.
- When an order becomes CONFIRMED (deposit met, E06) the temporary hold is released and the order is demand commitment until allocated (PRD §8). Until E07's job exists, Admin/Warehouse allocate manually.
- Safety stock is respected by holds and allocation. Only the Admin can override (`p_allow_below_safety`); the override is logged through the audit trigger on reservations.
- UI: the "Phân bổ hàng" button is Admin-only for now (Warehouse has no order screen until E07's delivery views); the database also lets Warehouse call `allocate_order`.
- `release_expired_reservations()` is Admin-only; pg_cron needs the extension to be enabled on staging/production (Supabase: Database → Extensions → pg_cron). Without it the lazy release still prevents stale holds from blocking new reservations.

## Validation log

- lint, typecheck, unit (129), build pass. pgTAP: 110 assertions (44 inventory + 66 reservations). Integration: 188 tests (16 new), stable on two runs.
- Browser-verified: Sale order form shows the live shortage warning ("Kho này không đủ hàng có thể bán: thiếu 25 cái. Đề xuất chuyển 25 từ … (cùng khu vực)."), order stock panel (coverage, shortage, suggestion), Admin confirm takes a 5/30 hold with a 24h countdown, Admin FEFO allocation dialog reports a partial allocation.
- Not manually checked: the full-allocation → RESERVED path in the UI (covered by integration tests), phone layout.
