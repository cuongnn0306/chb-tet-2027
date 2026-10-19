# INV-009 — read-only ledger session isolation (Claude scope)

Scope: `src/features/inventory/pages/MovementHistoryPage.tsx` only. Presentation and read-only
caching; no business-rule, schema, RLS, service, hook, auth or provider change.

## Problem

The ledger page queried with keys that did not depend on the signed-in account or role, kept
`placeholderData: previous`, and kept product/type/page state across an account or role change.
A second account on the same browser could therefore briefly see the previous account's rows or
inherit its filters, and queries ran for non-ledger roles before the route guard settled.

## Change

- `MovementHistoryPage` is now an access gate using `useAuth()` and the existing authoritative
  `LEDGER_VIEW_ROLES` (ADMIN, WAREHOUSE): loading → `LoadingState`; signed out / inactive /
  no profile / other roles → `NoPermissionState`; no query, service or lookup client is created.
- `MovementHistoryContent` owns the queries and the product/type/page state and is mounted with
  `key={userId:roleCode}`, so a new identity or role starts clean and a denied or inactive one
  unmounts it (observers are removed).
- Keys keep their prefixes (`inventory-products`, `inventory-movements`; BatchStockPage
  invalidates the latter by prefix) and add `userId, roleCode` right after the prefix.
- Removed the previous-data placeholder so earlier rows are never shown as placeholder.
- Table, Vietnamese copy, date/quantity formatting, filter/page semantics, and loading/empty/error
  states are unchanged.

## Acceptance evidence

| Criterion                                             | Evidence                                  |
| ----------------------------------------------------- | ----------------------------------------- |
| Account/role-scoped product and list keys             | Source review of the page                 |
| No reads/observers/rows for loading/denied/signed-out | Source review: content not mounted        |
| Filters/page reset on identity or role change         | Source review: `key` remount of state     |
| Prefix invalidation compatible                        | Prefixes unchanged                        |
| Permitted role sees same read-only history            | Source review only; browser not performed |

## Not verified

Browser/mobile, authenticated session and RLS behaviour were not exercised; source review does
not prove authentication or RLS. No dedicated regression test was added: the repository has no
component-render test tooling for this page, and mirroring the key shape in a unit test was ruled
out. Docker is unavailable, so DB reset, pgTAP and integration are `not_run` by blocker.

## Validation attempt: after Docker and local DB recovery (14/10/2026)

Validation-only; no implementation source changed. Starting state confirmed: branch
`codex/inv-009-claude-scope`, checkpoint `c17cc66`, clean tracked worktree, and the stale
`CHB_DB_VALIDATION_BLOCKER` key absent from the ignored local settings (checked by count only; no
values read). `task:finish` was run exactly once so it alone performed local DB reset, pgTAP and
integration under the shared lease. Actual check statuses and the source digest are recorded in the
new immutable report; the earlier report `INV-009-2026-10-13T05-02-00-916Z` is unchanged.

Still unverified without actual evidence: browser/mobile 320px, real account/role switching,
Auth/RLS behaviour, current-head CI, staging and Owner acceptance. This task is not Done.

Outcome of that attempt (historical, immutable report `INV-009-2026-10-14T15-12-57-073Z`): the
first seven checks passed; `supabase db reset --local` failed with `LocalDbRunningError` because the
Docker Linux-engine pipe (`dockerDesktopLinuxEngine`) was absent, so pgTAP and integration were
`not_run`. That Docker blocker is a historical condition of 13/10 and 14/10, not the current state.

## Validation attempt: retry after Docker Linux recovery (15/10/2026)

Validation-only retry; no implementation source, schema, service, auth, CI, package or config
change. Codex reported Docker Linux server 29.6.2 and healthy local CHB Supabase core containers.
Starting state confirmed: branch `codex/inv-009-claude-scope`, checkpoint `9b9827a` (preserves the
14/10 failed evidence), clean tracked worktree, and the stale `CHB_DB_VALIDATION_BLOCKER` key absent
from ignored local settings (count only; values not read). `task:finish` is run exactly once; it
alone performs local DB reset, pgTAP and integration while owning the shared DB lease. Actual check
statuses, source digest and any blocker are recorded in the new immutable report; earlier reports
are unchanged.

Still unverified without actual evidence: browser/mobile 320px, real account/role switching,
Auth/RLS behaviour, current-head CI, staging and Owner acceptance. Source review is not live
Auth/RLS evidence. This task is not Done.
