# ORD-014 — Printed order account boundary (Claude)

Scoped continuation of the closed print-page cache work. Not a new printing/report engine.
Baseline: composed stack at `60cdcd6`. Source scope: `src/features/orders/pages/OrderPrintPage.tsx`.

## Problem

`OrderPrintPage` queried `['order', orderId]` with no identity. After an account switch the
React Query cache could serve the previous account's printed order, and the page read data
whenever it was mounted, regardless of access state. A missing `orderId` fell back to `''`.

## Change

- Outer `OrderPrintPage` reads `useAuth().access` and mounts no query: loading → loading state;
  any non-`active` status (inactive, no_profile, signed_out) → no-permission state.
- Active access with an empty `orderId` → explicit error state with an actionable message
  (no disabled query, no indefinite loading). Router untouched.
- Query-bearing `OrderPrintContent` is keyed by `[userId, roleCode, orderId]`, so a user, role or
  order change remounts it. Query key is `['order', orderId, userId, roleCode]`: the existing
  `['order', orderId]` prefix is kept, so `OrderDetailPage` invalidations still reach it.
- No `placeholderData` / `keepPreviousData`; a previous account's rows are never shown.
- Unchanged: `service.get` (RLS decides visibility), every printed field, money values, order
  status label, item quantities, print CSS (`print:hidden`, `print:p-0`) and the print button.

## Out of scope

No client-side authorization replacing RLS, no new role rules, no quantity/price/payment logic,
no schema/types/RPC/services/hooks/auth/shared config/other pages, no new dependencies.

## Verification

- Pipeline (`task:finish`): lint, typecheck, unit, build, format, env check.
- No existing test harness renders this page (no component-test library in the repo), and the
  key-shape would only be a duplicate assertion, so no test is added.
- DB checks `not_run` (Docker unavailable, local DB blocker configured).
- Not verifiable from source review: browser print output, mobile layout, real account
  switching, RLS behaviour. The coordinator runs browser acceptance separately.

## Validation-only attempt (2026-10-14)

Follow-up after the Docker Linux engine was restored (coordinator evidence: reviewed SEC-004
report of 14/10). Checkpoint `9f62e94`, branch `codex/ord-014-claude-print`, clean tree; the 253
governed source hashes matched report `ORD-014-2026-10-13T08-17-23-445Z.json`. No implementation,
schema, service, auth, CI, package/config or business-rule change in this attempt.

- Single `task:finish` run; only it may reset the local DB, run pgTAP and integration while owning
  the shared `CHB_DB_LOCK_PATH` lease. No direct Supabase CLI, `test:db`, `test:integration`,
  borrowed lease, retry, or linked/staging/production DB.
- Exact check statuses are recorded in the new immutable report, not here.
- Still unverified (no actual evidence in this attempt): browser print output, 320px/mobile
  layout, real account switching/Auth/RLS, current-head CI, staging, Owner acceptance.

## Validation-only attempt 3 (2026-10-14, after stale DB blocker removal)

The previous report `ORD-014-2026-10-14T10-33-51-530Z.json` passed seven non-DB checks but DB
reset/pgTAP/integration were `not_run` because the ignored local settings still supplied the
stale 13/10 `CHB_DB_VALIDATION_BLOCKER`. The coordinator removed only that key (other settings and
`CHB_DB_LOCK_PATH` preserved). This is a new environment condition, not a retry of a DB command.

- Checkpoint `bed0ad8`, branch `codex/ord-014-claude-print`, tracked tree clean; blocker key
  confirmed absent and lock path key present by count only (no values read or printed).
- Single `task:finish` run; only it may reset the local DB, run pgTAP and integration while owning
  the shared lease. No direct DB command, borrowed lease, repeat on failure, or
  linked/staging/production DB.
- Exact check statuses and the source digest are recorded in the new immutable report.
- No implementation, schema, service, auth, CI, package/config or business-rule change.
- Still unverified: browser print output, 320px/mobile layout, real account switching/Auth/RLS,
  current-head CI, staging, Owner acceptance.

## Status

Needs validation. Not Done.
