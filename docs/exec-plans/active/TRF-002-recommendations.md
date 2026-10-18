# TRF-002: transfer-source recommendations on the request screen (E08, read-only)

Task: `TRF-002` · agent claude · branch `feature/TRF-002-recommendations` · base `60cdcd6` · one scoped attempt, then
independent Codex review.

TRF-002 adds the recommendation panel that TRF-001 left as a stand-in (PRD §B16, TECH_DESIGN §23 wireframe 09):
after the requester picks destination, SKU and quantity, the request screen shows ranked source locations and lets
them pick one. It is **advisory and read-only**. Approval (TRF-003), batch allocation (TRF-004), dispatch / receive
(TRF-005..007) and reject / cancel (TRF-008) are not touched.

## Readiness and non-duplication

| Item                                        | Evidence                                                                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E08 depends on E04                          | `IMPLEMENTATION_INFRA_PLAN` (`E08 \| Transfer \| E04`); ledger and balances committed                                                                                                                                             |
| Request RPC + page exist                    | TRF-001 (`request_transfer`, `TransferRequestPage`), committed at the base                                                                                                                                                        |
| Ranking already implemented in the database | `public.suggest_transfer_sources` (`20261001192601_reservations.sql`), corrected by `20261003044700_transfer_source_priority.sql`; integration tests `tests/integration/transfer-source-priority.test.ts`, `reservations.test.ts` |
| UI gap                                      | `TransferRequestPage` never calls the RPC (documented as TRF-002 in the TRF-001 plan)                                                                                                                                             |
| No duplicate TRF-002 record                 | none in `tasks.json` / `STATUS.md` of this worktree                                                                                                                                                                               |

## Scope (decided before any edit)

| File                                                                  | Change                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `docs/exec-plans/active/TRF-002-recommendations.md`                   | new (this plan)                                                                                         |
| `src/services/transfers.service.ts`                                   | add `suggestSources()` + types only; `requestOptions` / `request` / `list` / `get` unchanged            |
| `src/domain/transfers/recommendations.ts`                             | new, tiny: decides whether a recommendation read is allowed and for which inputs (no ranking, no stock) |
| `src/features/transfers/components/TransferSourceRecommendations.tsx` | new: panel (loading / empty / error / no-permission / list)                                             |
| `src/features/transfers/pages/TransferRequestPage.tsx`                | render the panel; selecting a row sets the existing `source` state; payload and defaults unchanged      |
| `tests/unit/transfers/transfer-recommendations.test.ts`               | new: service contract + query gating                                                                    |
| `tmp/TRF-002-summary.json`, reports, `tasks.json`, `STATUS.md`        | generated / ignored                                                                                     |

Not touched: `src/domain/transfers/transfers.ts`, shared UI / auth / router, migrations, RPC, RLS, generated types,
inventory / order / payment modules, package dependencies, orchestration files.

## Design

- **Backend does the ranking.** `suggestSources` calls `suggest_transfer_sources(p_product_id,
p_destination_location_id, p_quantity)` and returns rows in the order received (same region, enough quantity,
  earliest expiry, quantity, code). The client never sorts, filters, sums or recomputes stock and never mutates
  anything: it is one RPC and nothing else.
- **Input guard before the network.** Empty ids or a quantity that is not an integer in `1..MAX_LINE_QUANTITY`
  throw `TransferInputError` without an RPC call (the RPC would also refuse `<= 0`).
- **Query isolation.** `resolveRecommendationQuery(access, form)` returns `null` unless access is `active`, the
  role holds `propose_transfer` (same set the RPC allows: ADMIN, sales roles, WAREHOUSE) and destination, SKU and
  quantity are all valid. The React Query key contains user id, role, destination, SKU and quantity; no
  `placeholderData`, so a different key never shows a previous result, and a late response lands in its own key
  instead of changing what is displayed. `gcTime: 0` drops results once the panel unmounts or the key changes.
  `retry: false` so a 42501 / business error shows immediately; **Thử lại** refetches the same key and does not
  touch form state (the form owns its state, the panel only reads it).
- **Debounce only the typed quantity** (`useDebouncedValue`). While the typed text differs from the debounced text
  the panel shows "Đang cập nhật gợi ý…" instead of a list for a different quantity.
- **Selection is derived, never stored in the panel.** A row's "Chọn kho này" calls `onSelect(locationId)`, which
  sets the existing `source`. Responses never auto-select. A manually chosen source is never overridden. The
  "Kho xuất hàng" select stays as the manual fallback and is the field that is submitted.
- **No Batch / FEFO controls and no batch or expiry data on screen.** Only location, region hint, sellable
  quantity and whether it covers the requested quantity are shown. Coverage is information: a partly covering
  source can still be chosen (no new rejection, no auto-split, no quantity cap).
- **Copy states plainly** that the list is a suggestion and does not reserve, approve or move stock.
- Mobile: single column, full-width 44px buttons (`Button` = `min-h-11`), one primary submit CTA (recommendation
  buttons are `secondary`).

## Tests

- Service: exact RPC name and arguments, no other client call (no `from`, no write RPC); backend order retained for
  an order the client would not produce itself; empty / null data; `42501` and business errors propagate as
  `DbError` and map through `describeDbError`; invalid input makes no RPC call; `request()` still sends the same
  payload.
- Gating: signed-out / loading / no-profile / inactive / PRODUCTION / missing or invalid input return `null`; valid
  input returns the key parts; two users or two destinations produce different identities.
- Existing RPC permission and ranking integration tests are unchanged.

## Not done / open (needs other evidence, not claimed)

- Real browser and mobile device check of the panel; this task adds classes only, which is not visual QA.
- Real Auth / RLS / database run of the RPC from the screen; local DB checks are `not_run` while the Docker engine
  is unavailable (inherited `CHB_DB_VALIDATION_BLOCKER`).
- CI, staging and Owner acceptance. Transfer approval / dispatch / receive acceptance is pending in TRF-003..007.

## Validation-only attempt 2 (2026-10-14, after Docker Linux engine restoration)

- Scope: no source, schema, contract, permission or business-rule change. Checkpoint `7c7d70a` (worktree clean) with the
  immutable attempt-1 report `TRF-002-2026-10-14T02-24-28-929Z`, where DB reset, pgTAP and integration were `not_run`.
- Reason: the Owner started Docker Desktop and the coordinator verified the Linux engine and the CHB Supabase DB
  container; the inherited `CHB_DB_VALIDATION_BLOCKER` was removed from this worktree's ignored local settings and
  `CHB_DB_LOCK_PATH` retained.
- Method: one `npm run task:finish -- TRF-002 tmp/TRF-002-summary.json`. Only that pipeline may run the local DB reset,
  pgTAP and integration checks under the shared lease; no direct DB command, no retry of an unchanged failing reset.
- Result: recorded by the attempt-2 report in `docs/handoff/reports/` (exact per-check status and source fingerprint);
  it is not restated here so this plan cannot drift from the evidence.
- Unchanged acceptance: rendered isolation/retry, select-and-submit, mobile layout, live Auth/RLS from the screen, CI,
  staging and Owner acceptance remain `not_verified`. A passing local DB run does not satisfy them; this is not Done.

## Status

Attempt 2 closed as `needs_validation` after local DB recovery. See `docs/handoff/reports/TRF-002-*.md`; browser/mobile, staging, CI and Owner acceptance remain open. This task is never Done without external acceptance.
