# RES-005: allocation lead time, automatic physical allocation by delivery date (review RV-07)

Task: `RES-005` · agent claude · branch `feature/DEL-012-failed-logistics` · one attempt, one immutable report.

## Scope (decided before any edit)

| File                                                                     | Change                                                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `docs/exec-plans/active/RES-005-allocation-lead-time.md`                 | new (this plan)                                                                              |
| `supabase/migrations/20261004100000_res005_delivery_auto_allocation.sql` | new, additive: shared engine, job, Admin wrapper, local cron registration                    |
| `supabase/tests/delivery_auto_allocation.test.sql`                       | new pgTAP: lead-time/date semantics, eligibility, siblings, logistics, shortage, idempotence |
| `tests/integration/delivery-auto-allocation.test.ts`                     | new: permissions, Admin run, concurrency with the manual RPC, audit, manual behaviour intact |
| `docs/exec-plans/active/E05-reservation-fefo.md`                         | RES-005 row only                                                                             |
| `src/types/database.generated.ts`                                        | regenerated only by `task:finish --generate-types` (never by hand)                           |
| `tmp/RES005-summary.json`                                                | task summary                                                                                 |

Out of scope (no lane overlap): UI, `allocate_order`, `reserve_order_stock`, DEL-011 binding, the DEL-005 coverage engine
itself, payments, cloud settings, any change of the manual RPC signature or authorization.

## Dependency evidence

| Dependency                                 | Evidence                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule: lead time is configurable, not coded | PRD_UIUX §8.2 ("Allocation Lead Time = X ngày trước giao", "Không hard-code"), §29; AGENTS §4 Reservations; IMPLEMENTATION_INFRA_PLAN RES-004/005 ("Admin configurable")                   |
| Setting exists                             | TECH_DESIGN §3.26 `allocation_lead_days`; `20261001180105_app_settings.sql:38` validates an integer 0..365; seeded to 5 (`seed.sql:74`)                                                    |
| Confirmed demand vs physical allocation    | E05 RES-004 `committed_demand()`: CONFIRMED orders are demand only; this task is the only place that turns demand into physical stock automatically                                        |
| Delivery date exists                       | E07 / `20261001200342_deliveries_workflow.sql`: `deliveries.scheduled_date`, `source_location_id`; E05 plan and E07 plan both list RES-005 as "not done"                                   |
| Primitive to reuse                         | `public.allocate_delivery_stock` (`20261003080000`) and `private.delivery_stock_coverage` (corrected by `20261004090000`): per delivery/line/location gap, FEFO, safety stock, no negative |
| Cron/expiry pattern                        | `20261001192601_reservations.sql:280` `private.expire_temporary_reservations()`, `:727` guarded `pg_cron` registration; Admin-only `release_expired_reservations()`                        |
| Alert semantics                            | TECH_DESIGN §43 "Delivery stock risk: Delivery trong X ngày nhưng chưa đủ physical allocation": already computed by `delivery_schedule.stock_risk` (no persistence required)               |
| Business day                               | `private.business_today()` = `now() at time zone 'Asia/Ho_Chi_Minh'`                                                                                                                       |
| Review finding                             | `docs/reviews/2026-10-02-project-review.md` RV-07                                                                                                                                          |
| DEL-005 locally validated                  | `docs/handoff/reports/DEL-005-2026-10-03T18-51-07-172Z.md`: every local check passed (incl. DB reset, pgTAP, integration); external DoD still pending                                      |
| INF-008 pipeline incl. generated types     | `docs/handoff/reports/INF-008-2026-10-04T03-16-56-295Z.md`: 13 checks incl. `generate types` under the owned lease; WORKFLOW.md documents `--generate-types`                               |

## Approved semantics (taken from the specs, nothing invented)

1. **Due date.** A delivery is due for physical allocation when `scheduled_date - allocation_lead_days <= business day`
   (Vietnam calendar day). Late (past-due) open deliveries are still due.
2. **Not configured.** If `allocation_lead_days` is missing the job fails with an actionable Vietnamese message instead of
   a hidden default (same decision as RES-002 for the TTL).
3. **Eligible.** Delivery `PREPARING`/`READY` and never dispatched (`dispatched_at is null`: goods already in logistics are
   skipped, DEL-012), order in `CONFIRMED`/`RESERVED`/`PREPARING`/`WAITING_DELIVERY` (identical to the manual RPC's rule).
   Everything else is skipped, not an error. Orders with no delivery have no delivery date and are never auto-allocated.
4. **Amount and source.** Exactly the delivery's own gap (DEL-005 coverage) at its own `source_location_id`, FEFO, never below
   safety stock (the Admin override stays manual-only), never negative, all-or-nothing per delivery. A future sibling
   delivery that is not yet due is neither reserved nor starved: pooled order-wide holds keep their existing priority rule.
5. **Order of work.** Earliest `scheduled_date`, `scheduled_time`, creation (deterministic, fair when stock is short).
6. **Idempotence.** A delivery already covered is a no-op; re-running changes nothing.
7. **Shortage.** Nothing is reserved. Actionable evidence is stored with the existing audit pattern: an immutable `audit_logs`
   row (`deliveries`, `auto_allocate_shortage`) with the shortage per line and transfer suggestions (`stock_check_lines`),
   written once per distinct shortage (signature dedupe against the latest evidence of that delivery). The board keeps showing
   `stock_risk`. No new table, status or role rule.
8. **Failure isolation.** One delivery failing rolls back only itself (sub-transaction) and is recorded as
   `auto_allocate_failed` evidence; the run continues.
9. **Concurrency.** One run at a time (advisory transaction lock); locked deliveries are skipped until the next run; the
   shared engine keeps the delivery-then-order lock order, so a manual allocation racing the job reserves once.
10. **Audit.** Reservation rows via the existing trigger (reason names the lead time), the existing `allocate_stock` audit row,
    actor NULL = system, exactly as `audit_logs` documents for system actions.

## Design

- `private.allocate_delivery_stock_core(delivery, allow_below_safety, actor, note)`: the former body of
  `public.allocate_delivery_stock` after its permission checks, moved verbatim (actor becomes a parameter). The public RPC keeps
  its signature, its Admin/Warehouse check, the Admin-only safety-stock check and its results; it now only calls the core.
- `private.allocate_due_deliveries(p_as_of date default business_today)`: the job. No JWT/identity is spoofed and no permission
  check is bypassed: it calls the trusted private engine, which was never permission-gated by itself.
- `public.run_due_delivery_allocation()`: Admin-only wrapper (like `release_expired_reservations`), used by the Admin and by tests.
- Cron: `pg_cron` registration in the migration only (guarded, hourly at minute 7), same local pattern as RES-003; cloud
  settings are not touched. Without the extension the Admin wrapper still works.

## Tests

- pgTAP (`supabase/tests/delivery_auto_allocation.test.sql`, rolled back, calls the private job with explicit dates): day
  boundary around the lead time incl. lead 0, due vs not-due sibling, past-due, goods in logistics skipped, ineligible order and
  delivery status skipped, missing setting error, FEFO and exact amount, pooled order-wide hold not doubled, shortage keeps
  stock untouched, shortage evidence written once then again when it changes, idempotent second run, safety stock respected.
- Integration (`tests/integration/delivery-auto-allocation.test.ts`): Sale/Store/Warehouse/anon denied, Admin allowed, manual
  RPC authorization and results unchanged, job and manual allocation racing never double-reserve, `verify_inventory_balances`
  clean, audit rows with a NULL actor, setting restored after each test.

## Not done / open (no business rule invented)

- Releasing a physical hold when a delivery is rescheduled later: the specs define no rule; the hold stays.
- The manual RPCs (`allocate_order`, `allocate_delivery_stock`) keep no lead-time guard: they are the explicit Admin/Warehouse
  override; RV-07's "manual has no guard" is therefore answered by the automatic path, not by blocking staff.
- Job cadence (hourly) is a technical choice; it can be tightened without a schema change.
- Notifications/alert screens beyond `stock_risk` and the audit evidence are E10 scope.

## Status

First attempt (`docs/handoff/reports/RES-005-2026-10-04T07-31-40-209Z.md`, `needs_validation`): every check passed
(lease, DB reset, generated types, integration, lint, typecheck, unit, build, format) except pgTAP, which failed 1 of 52
assertions: test 8 expected `RESERVED`. Review (`docs/reviews/2026-10-04-RES005-post-quota-review.md`) found the engine
correct: it moves a fully covered `CONFIRMED` order to `RESERVED` and the existing `orders_zz_fulfilment_sync` trigger
(`20261001200342_deliveries_workflow.sql:326-332,361-380`, TECH_DESIGN §6 `RESERVED --> PREPARING`) then advances an order
with an open delivery to `PREPARING`. The assertion, not the engine, was wrong.

Correction attempt: only that assertion and its wording changed (now expects `PREPARING` and documents the sequence); the
migration, the integration test and every other pgTAP assertion are unchanged. Result: see this attempt's report. Not Done:
staging (pg_cron registration and cadence), mobile and independent review pending.
