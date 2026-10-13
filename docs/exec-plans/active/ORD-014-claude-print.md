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

## Status

Needs validation. Not Done.
