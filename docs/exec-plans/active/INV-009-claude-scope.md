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
