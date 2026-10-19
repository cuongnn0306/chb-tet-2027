# PRD-002: production need calculator (E09, pure arithmetic only)

Task: `PRD-002` · agent claude · one attempt, one immutable report.

PRD-002 is a typed pure function that turns four **already aggregated** quantities into a suggested production quantity.
It does not read, aggregate or write data. PRD-001 (committed demand aggregation), PRD-003 (suggested plan), the E08
transfer flow, schema, RPC, services and UI are separate tasks and are **not** implemented here.

## Scope

| File                                                | Change                                    |
| --------------------------------------------------- | ----------------------------------------- |
| `src/domain/production/need.ts`                     | new: `calculateProductionNeed`            |
| `tests/unit/domain/production-need.test.ts`         | new unit tests                            |
| `docs/exec-plans/active/PRD-002-need-calculator.md` | new (this plan)                           |
| `tmp/PRD-002-summary.json`                          | task summary (generated pipeline reports) |

## Dependency boundary

| Item                                                  | State                                                                                                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formula                                               | `IMPLEMENTATION_INFRA_PLAN` §PRD-002: Committed Demand + Safety Target - Available - Scheduled Production                                                                    |
| Quantity labels                                       | PRD §B18 production dashboard columns: Nhu cầu đã cam kết, Safety, Tồn, Đang SX, Thiếu, Đề xuất                                                                              |
| Integer fields                                        | TECH_DESIGN §3.17 `production_plans`: `committed_demand_qty`, `safety_stock_target`, `available_qty`, `scheduled_qty`, `suggested_qty` are `int`                             |
| PRD-001 committed demand source                       | **not implemented / not accepted**. The calculator takes the number as an argument; nothing here proves the number is right                                                  |
| `available` and `scheduled` sources                   | not defined by this task (stock balances, production runs); the caller supplies them                                                                                         |
| E08 transfer flow                                     | not accepted; transfers in flight are not modelled and must be decided in PRD-001/003                                                                                        |
| Does a genuine dependency make a pure function unsafe | No. The function is total over its declared input and has no hidden state, so it is safe to land independently; whether its inputs are correct is a PRD-001/PRD-003 concern. |

## Behaviour

`suggestedQty = max(0, (committedDemand + safetyTarget) - (available + scheduled))`

Returns `{ ok: true, suggestedQty, requirement, supply }` or `{ ok: false, issues }`.

- Each input must be a `number` that is finite, an integer, within `Number.MAX_SAFE_INTEGER` and non-negative.
  Issue codes: `NOT_A_NUMBER` (also strings, `null`, `undefined`, `bigint`, NaN, ±Infinity, a missing field),
  `NOT_INTEGER`, `UNSAFE_INTEGER`, `NEGATIVE` (including `-0`). Nothing is rounded, parsed or clamped.
- All four fields are checked and every issue is returned together (no early exit), so a screen can flag them at once.
- Safe-integer protection: `committedDemand + safetyTarget` and `available + scheduled` are each checked with
  `Number.isSafeInteger`; a sum outside the range is `SUM_OVERFLOW` (field `requirement` / `supply`) and no quantity is
  returned. This holds even when the shortage would be zero, because an inexact supply could hide a real shortage.
- Surplus is a legitimate result, not an error: supply above the requirement gives `suggestedQty = 0`, and
  `requirement` / `supply` are returned so the dashboard can still show the surplus.

## Decisions to confirm (not blocking)

1. **Database range.** TECH_DESIGN says `int` (Postgres int4, 2,147,483,647) but the calculator guards only the JS safe-integer
   range. PRD-003, which persists the value, must bound inputs and the result to the column type; no int4 limit is invented here.
2. **Returning a result, not throwing.** Invalid input is data a screen must show, so it is returned as `issues`. A caller that
   wants an exception can throw on `ok === false`.
3. **Rounding to batch size** (e.g. pans of N cakes) is not specified anywhere and is not applied.

## Tests (`tests/unit/domain/production-need.test.ts`)

All zero; shortage; safety only; scheduled production reduces and can cancel the suggestion; surplus floors at zero with
both sides exposed; exact match; exactness at `MAX_SAFE_INTEGER`; every invalid value class on each of the four fields
(negative, `-0`, fraction, NaN, ±Infinity, string, null, undefined, bigint, 2^53, 1e300); multiple issues reported
together; a missing field is not zero; sum overflow on the requirement, on the supply, on both, and the largest exact sums.

## Acceptance evidence

| Criterion                                                  | Status                   | Evidence                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed pure function in `src/domain/production/need.ts`     | implemented              | file added; no imports, no I/O                                                                                                                                                  |
| Formula matches the plan, zero floor on surplus            | covered by written tests | `production-need.test.ts` (shortage, scheduled, surplus, exact match)                                                                                                           |
| Invalid / unsafe / overflowing input explicit, not coerced | covered by written tests | `production-need.test.ts` (invalid input matrix, sum overflow)                                                                                                                  |
| Focused tests executed                                     | pass                     | Coordinator ran `npm test -- tests/unit/domain/production-need.test.ts`: 61/61 pass.                                                                                            |
| Full unit suite                                            | pass                     | Coordinator ran `npm test` with workspace-local TEMP/TMP: 25 files, 324/324 tests pass.                                                                                         |
| Lint, typecheck and build                                  | pending second pipeline  | First pipeline run passed all three; scoped formatting changes require a fresh validation run.                                                                                  |
| Pipeline fixture tests                                     | environment blocked      | 44/62 pass; 18 Git fixture tests fail because sandbox-created temporary repositories have different Windows ownership. No Git trust bypass was applied.                         |
| `task:start` run                                           | recovered, out of order  | Coordinator ran `npm run task:start` after Claude wrote the three files because Claude's Bash could not start. This sequencing exception is retained in the report; not hidden. |

## Unresolved

- PRD-001 committed demand aggregation (and the E08 transfer effect on it) is not done: production planning as a whole is
  **not** complete. This task only provides the arithmetic PRD-003 will call.
- No mobile, staging or review evidence; this task has no UI.

## Status

Focused and full unit tests pass; pipeline fixture tests remain blocked by sandbox ownership, and DB checks remain pending. Never Done without external acceptance.
