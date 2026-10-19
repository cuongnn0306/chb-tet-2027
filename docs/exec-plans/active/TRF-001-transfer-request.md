# TRF-001: transfer request (E08, request stage only)

Task: `TRF-001` · agent claude · branch `feature/DEL-012-failed-logistics` · one attempt, one immutable report.

TRF-001 only lets an authorised user **ask** for stock to be moved from one location to another and lets the
requester and the Admin read the request. Recommendation (TRF-002), approval (TRF-003), batch allocation (TRF-004),
dispatch / in-transit / receive (TRF-005..007), reject / cancel (TRF-008) and printing (TRF-009) are separate tasks and
are **not** implemented or pre-empted here.

## Scope (decided before any edit)

| File                                                             | Change                                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `docs/exec-plans/active/TRF-001-transfer-request.md`             | new (this plan)                                                                                     |
| `supabase/migrations/20261004110000_trf001_transfer_request.sql` | new, additive: `transfers`, `transfer_items`, guards, RLS, audit, `request_transfer()` RPC          |
| `supabase/tests/transfer_request.test.sql`                       | new pgTAP: request operation, validation, state machine guard, no stock effect, RLS, permissions    |
| `tests/integration/transfer-request.test.ts`                     | new: roles through the API, RLS visibility, no direct writes, concurrency, no ledger/balance effect |
| `src/domain/transfers/transfers.ts`                              | new: status labels, state machine, pure request validation                                          |
| `tests/unit/transfers/transfers.test.ts`                         | new unit tests for the domain module                                                                |
| `src/services/transfers.service.ts`                              | new typed service (RPC + reads)                                                                     |
| `src/features/transfers/**`                                      | new: hook, request form page, queue page, detail page                                               |
| `src/app/routes.ts`, `router.tsx`, `AppLayout.tsx`               | routes + navigation entry                                                                           |
| `src/types/database.generated.ts`                                | regenerated only by `task:finish --generate-types` (never by hand)                                  |
| `tmp/TRF-001-summary.json`                                       | task summary                                                                                        |

Out of scope (no overlap with other lanes): recommendation ranking, `suggest_transfer_sources`, approval / reject / cancel
RPCs, `inventory_movements` / `inventory_balances` / `post_inventory_movement`, the `inventory_movements.transfer_id` FK
(added by the dispatch task that first writes it), production, payments, deliveries, RES-005, INF-008, Codex worktrees.

## Dependency evidence

| Dependency                           | Evidence                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E08 depends on E04                   | `IMPLEMENTATION_INFRA_PLAN` line 151 (`E08 \| Transfer \| E04`)                                                                                                                |
| Locations, products, batches, ledger | `20261001172138_master_data_base.sql`, `20261001174301_products.sql`, `20261001184806_inventory_schema.sql`, `20261001184810_inventory_posting.sql`                            |
| Permission `propose_transfer`        | `20261001171626_roles.sql` (ADMIN, SALE_B2B, STORE_STAFF, FRANCHISE_STAFF, WAREHOUSE; not PRODUCTION), `src/domain/auth/roles.ts` (`PERMISSION_MATRIX`), TECH_DESIGN §2 matrix |
| Tables and state machine             | TECH_DESIGN §3.15 `transfers`, §3.16 `transfer_items`, §8 Transfer state machine                                                                                               |
| UI intent                            | TECH_DESIGN §23 wireframe 09, §24 wireframe 10; PRD §B16 "Screen spec — Transfer"                                                                                              |
| Ledger already supports transfers    | `inventory_movements.transfer_id` column exists (FK deferred "with transfers (E08)"), `post_inventory_movement` handles `TRANSFER_OUT` / `TRANSFER_IN`, untouched here         |
| No pipeline conflict                 | `tasks.json` has no TRF-001 entry; coordinator `activeDispatch` reserves exactly the scope above                                                                               |

## Approved semantics taken from the specs

1. A request is a `transfers` row (`status = REQUESTED`) with `transfer_items` lines (`requested_qty > 0`); the code is generated by
   the database (`TR-0001`, the form shown in TECH_DESIGN §24 / the `TR-0012` examples; a sequence, gaps possible).
2. `REQUESTED` is the only status a transfer can be created in. Later statuses and transitions follow TECH_DESIGN §8 exactly:
   `REQUESTED→APPROVED|REJECTED|CANCELLED`, `APPROVED→DISPATCHED|CANCELLED`, `DISPATCHED→RECEIVED`. A database guard refuses every
   other transition. No RPC performs a transition in this task.
3. A request does not touch `inventory_movements`, `inventory_balances`, `inventory_reservations` or revenue. It makes no stock check
   (the approval screen shows sellable stock and safety impact: PRD §B16), reserves nothing and selects no batch.
4. Only `private.has_role(...)` roles holding `propose_transfer` can request. Clients have no INSERT/UPDATE/DELETE privilege on the
   new tables; the only door is the `SECURITY DEFINER` RPC `request_transfer()`.
5. Transfers are never deleted and `requested_qty`, product, locations and requester never change after creation.
6. Audit: row-level `audit_row_change` triggers on both tables (actor = requester) with a reason.

## Ambiguities (recorded, resolved conservatively, nothing blocking)

| #   | Question                                                                                        | Resolution in this task                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | PRD §B16 / wireframe 09: user picks destination, SKU, qty and the system _recommends_ a source. | TECH_DESIGN §3.15 has `source_location_id` and the task statement asks for a request with source, destination, SKU, qty. TRF-001 therefore takes the source from the requester (it can always be changed by approval later); ranking is TRF-002.  |
| A2  | Which destinations may a user ask for? No per-location rule exists in the specs.                | No scoping is invented: any role with `propose_transfer` may request for any **active** destination. Raising a location-scoping rule is a product decision for the Owner (see Notes).                                                             |
| A3  | `transfer_items.batch_id` is a non-null-looking FK in §3.16.                                    | Made nullable: the task forbids choosing batches at request time; TRF-004 assigns them. Quantities `approved/dispatched/received` default to 0 and must be 0 when a line is created.                                                              |
| A4  | `transfers.reason` is a plain `text` (not marked nullable) in §3.15.                            | Treated as required, non-blank, ≤ 500 characters, shown to the Admin as "Lý do / ghi chú". It cannot be edited afterwards. Rejection / cancellation reasons are for TRF-008 (their column is that task's decision).                               |
| A5  | One SKU (wireframe 09) or several lines (`transfer_items`)?                                     | The RPC and the service accept 1..50 distinct products (data model); the screen offers one SKU per request, exactly like the wireframe. A multi-line editor is a UX follow-up, not a business rule.                                               |
| A6  | Who may read requests? The task says "Admin-readable queue/detail".                             | Admin reads all; the requester reads their own (traceability). Warehouse visibility of other users' requests belongs to TRF-005..007 where it is needed (least privilege until then).                                                             |
| A7  | Duplicate submit (double tap / retry on a bad mobile network).                                  | The button is disabled while saving. No idempotency key is added because none is specified; a duplicate would create a second `REQUESTED` row that the Admin can reject/cancel once TRF-003/008 exist. Recorded as a risk, not silently invented. |
| A8  | Notification `transfer_requested` (PRD §notifications).                                         | Notifications are a separate module; the audit log and the Admin queue are the signal in this task.                                                                                                                                               |
| A9  | `inventory_movements.transfer_id` FK to `transfers`.                                            | Deliberately not added: this task must not touch the ledger table; the dispatch task that first writes a transfer movement adds it.                                                                                                               |

## Design

- `private.can_propose_transfers()`: `has_role(ADMIN, SALE_B2B, STORE_STAFF, FRANCHISE_STAFF, WAREHOUSE)`; parity with
  `PERMISSION_MATRIX.propose_transfer` is asserted by the integration test.
- `public.request_transfer(source, destination, items jsonb, reason)`: validates permission, locations (distinct, active, locked
  `FOR SHARE`), reason, lines (array, ≤ 50, product uuid, integer quantity ≥ 1 and bounded, no duplicates, product active),
  then inserts the transfer and lines in one transaction and returns the transfer with its lines. Errors are Vietnamese `P0001` /
  `42501` messages already handled by `describeDbError`.
- Guards: `transfers_guard` (code assignment, REQUESTED on insert, frozen identity fields, §8 transitions only, no delete) and
  `transfer_items_guard` (parent must be REQUESTED on insert, frozen product / requested quantity, no delete); both tables also
  refuse TRUNCATE. A `CHECK` keeps approval / dispatch / receipt fields empty while `REQUESTED`.
- RLS: Admin sees all, a user sees their own requests; lines follow their transfer. `anon` has nothing.
- UI (`/transfers`, `/transfers/new`, `/transfers/:id`): standard `LoadingState` / `EmptyState` / `ErrorState` /
  `NoPermissionState`, Vietnamese copy with an explicit "chưa trừ tồn kho" message, single-column mobile form with 44px controls,
  no business rule in components (validation is `src/domain/transfers`, enforcement is the database).

## Tests

- pgTAP (`supabase/tests/transfer_request.test.sql`, rolled back): a valid request creates `REQUESTED` + lines + audit rows and **no**
  ledger / balance / reservation change; code format and uniqueness; every validation failure; permission per role incl.
  PRODUCTION and no profile; guard refuses invalid transitions, edits of frozen fields and deletes; valid §8 edges pass the guard;
  RLS (requester vs another user vs Admin vs anon); direct INSERT refused for `authenticated`.
- Integration (`tests/integration/transfer-request.test.ts`): `PERMISSION_MATRIX.propose_transfer` parity for all seven seeded users
  (incl. inactive), end-to-end through the typed service, RLS visibility, no direct table writes, parallel requests get distinct
  codes, `verify_inventory_balances()` unchanged, no revenue side effect (no orders/payments rows are created).
- Unit (`tests/unit/transfers/transfers.test.ts`): validation, state machine edges, labels.

## Not done / open

- Approval, rejection, cancellation, batch allocation, dispatch, transit, receipt, print: TRF-002..009.
- Recommendation panel on the request screen (wireframe 09) is TRF-002; the source select is the TRF-001 stand-in.
- Browser / mobile device check and staging verification are not performed by this task (see report).

## Code-overflow correction (attempt 4)

Independent review found that `lpad(nextval(...)::text, 4, '0')` **truncates** values longer than four characters
(PostgreSQL documents this), so sequence value 10000 would have become `TR-1000` and collided with request 1000 on the
unique constraint. `transfers_guard` now draws one value into a variable and pads only values below 10000
(`TR-0001` … `TR-9999`, then `TR-10000`, `TR-10001`, …), keeping every digit. The format stays "TR- plus four or more digits",
which the existing regex and integration test already accept.

Regression test (`supabase/tests/transfer_request.test.sql`, last section): moves `private.transfer_code_seq` forward to 9998
only if it is lower (never rewinds; sequences are not transactional, so the move survives the test's rollback and later
integration tests simply see five-digit codes), then asserts `TR-9999` through the RPC, `TR-10000` through a direct insert
that supplies a different code (trigger boundary; the supplied code is ignored) and `TR-10001` through the RPC, all distinct.
Other `lpad` uses (orders, payments) have six-digit padding and belong to other tasks; they are not changed here.

## Status

In progress (attempt 1). See `docs/handoff/reports/TRF-001-*.md` for the immutable evidence; this task is never Done without external
acceptance.
