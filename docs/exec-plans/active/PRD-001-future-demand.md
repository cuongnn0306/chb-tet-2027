# PRD-001: future committed demand by SKU and needed date

Task: `PRD-001` · agent claude · epic E09 · one attempt, one immutable report (written by the coordinator's `task:finish`).

## Scope

| File                                                                    | Change                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `supabase/migrations/20261006044000_prd001_future_committed_demand.sql` | new, additive: `public.future_committed_demand()` (read only)      |
| `src/domain/production/committed-demand.ts`                             | new: pure reference of the same rules, types, per-SKU summary      |
| `src/services/production-demand.service.ts`                             | new: typed wrapper of the RPC                                      |
| `tests/unit/domain/committed-demand.test.ts`                            | new: calculation, status filtering, multi-delivery, reconciliation |
| `tests/integration/production-demand.test.ts`                           | new: same cases against the database, plus permissions             |
| `src/types/database.generated.ts`                                       | not edited; regenerated only by the coordinator's `task:finish`    |

Out of scope: `committed_demand()` (signature and body unchanged), order/reservation/allocation contracts, RLS, UI, PRD-002
calculator, any production plan table. No new status, allocation policy or production policy.

## Dependency evidence

| Dependency                       | Evidence                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Demand definition                | PRD_UIUX §15 formula; TECH_DESIGN §6.4 "CONFIRMED ... được tính future committed demand"; AGENTS §4 "future confirmed demand and physical allocation are separate" |
| Existing invariant               | `20261001192601_reservations.sql:574` `committed_demand()`: `orders.status = 'CONFIRMED'`, `sum(quantity - allocated_quantity)` per product                        |
| Date source                      | `deliveries.scheduled_date`, `delivery_items.quantity` (`20261001200338_deliveries_schema.sql`); no date exists on `orders`/`order_items`                          |
| No double counting of deliveries | `private.delivery_items_guard` counts a line's assigned quantity over deliveries with `status <> 'CANCELLED'`; the read model uses the same set                    |
| Permission                       | same as `committed_demand()`: Admin, Warehouse, Production (`private.has_role`), Sale/Store/anon denied                                                            |
| Plan task                        | IMPLEMENTATION_INFRA_PLAN E09 PRD-001 (no acceptance text of its own); E09 acceptance: "Production dashboard phản ánh đơn tương lai"                               |

## Rules implemented (nothing invented)

1. Only `CONFIRMED` orders; only the unallocated remainder `quantity - allocated_quantity > 0` (identical to `committed_demand()`).
   RESERVED and later statuses, DRAFT, WAITING_*, CANCELLED, VOIDED, RETURNED, EXCHANGED never count.
2. Needed date comes only from the line's non-CANCELLED deliveries, summed per `scheduled_date` (two deliveries of one line on the
   same day are one row; a multi-delivery line is split over its dates once).
3. Output `date_basis`:
   - `DELIVERY_DATE`: the date is determinate.
     a) the line has no allocated unit: every delivery quantity is uncovered at its own date;
     b) the line is partly allocated but fully scheduled on one date: the remainder is at that date.
   - `UNSCHEDULED`: `needed_date` is NULL. Part of the line is on no delivery (no delivery, or quantity not yet assigned), or a partly
     allocated line has no delivery at all.
   - `DATE_UNDETERMINED`: `needed_date` is NULL, candidate range in `earliest_candidate_date`/`latest_candidate_date`. See blocker.
4. Invariant: for every product `sum(committed_qty over all rows) = committed_demand().committed_qty`. No row is dropped.
5. Past dates are not filtered (that would break rule 4); consumers decide how to show an overdue date.
6. `order_count` is the number of distinct orders inside one row; an order with several dates appears in several rows.

## Blocker (documented, not decided): attributing allocated units to a delivery date

A partly allocated line with several dates (or with an unscheduled part) cannot be dated from approved data. `allocated_quantity` is a
line-level total, while DEL-005 attributes units per delivery AND per source location with a priority waterfall
(`private.delivery_stock_coverage`: dispatched first, then date, time, creation). Whether demand should inherit that waterfall
(allocated units cover the earliest deliveries first, so the uncovered remainder sits on the latest dates), or be split pro rata, or
stay undated, is a business rule that the PRD/TECH_DESIGN do not state for demand. The implemented safe subset reports the full
uncovered quantity as `DATE_UNDETERMINED` with its candidate date range. Decision needed from the product owner before PRD-002/PRD-003
place that quantity on a production day. Nothing else in the read model depends on the answer, and adopting a rule later only changes
which bucket this quantity moves to, never the totals.

## Tests

Unit (run by the pipeline, no DB): calculation, status filtering for each non-CONFIRMED status, cancelled delivery, fully allocated
line, multi-delivery split without double counting, same-day merge, one order counted once per row, partly allocated (determinate,
undetermined, unscheduled), per-SKU totals equal to the `committed_demand()` reference, summary, row mapping.

Integration (needs local DB): permissions (Admin/Warehouse/Production allowed, Sale/Store/anon denied, `committed_demand()` unchanged),
multi-delivery split reconciled with `committed_demand()`, several orders on one date, unscheduled order, unscheduled remainder,
non-CONFIRMED orders ignored, cancelled delivery gives quantity back, partly allocated multi-delivery line (`DATE_UNDETERMINED`, total
= `committed_demand()` = 6), fully allocated order leaves the demand.

## Acceptance evidence status

| Criterion                                                    | Status       | Evidence / reason                                                                                          |
| ------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------- |
| Demand per SKU and needed date where the date is determinate | not_verified | Implemented; SQL and TS reference written, no check could be run in this attempt (see below)               |
| Confirmed/unallocated invariant preserved, no double count   | not_verified | By construction (same filter and quantity); proven in unit reference test and integration test, both unrun |
| Unscheduled / undetermined demand explicit                   | not_verified | `UNSCHEDULED` and `DATE_UNDETERMINED` buckets; tests written, unrun                                        |
| Permissions                                                  | not_verified | Integration test written; needs the local DB                                                               |

## Checks not run in this attempt

- Docker/DB (reset, pgTAP, integration, generated types): `not_run`, inherited Docker Desktop blocker; the coordinator runs `task:finish`.
- `vitest` unit run, `npm run lint`, `npm run typecheck`, `npm run build`, `prettier`: not run. The shell tool was denied
  mid-attempt ("don't ask" permission mode) after the files were written, so none of these ran. The migration SQL has never been
  executed. The coordinator's `task:finish` will run lint/typecheck/tests/build/format; formatting of the four new TS files and this
  document may need `prettier --write`.
- Mobile, staging, review: not verified (no UI, nothing deployed).

## Next

- Product decision on the blocker above, then PRD-002 (calculator) can consume `future_committed_demand()` rows by date.
- PRD-010 dashboard uses `summarizeByProduct` to show dated / unscheduled / undetermined quantity per SKU.
