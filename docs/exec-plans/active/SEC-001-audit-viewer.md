# SEC-001: Admin read-only Audit Log viewer

Source: PRD_UIUX §3.1 ("Xem Audit Log"), §21 (Soft delete & audit), B24 (Screen spec — Audit Log: Admin only; filter
User / Entity / Action / Date; row Time | User | Entity | Action | Reason; detail Before / After / related entity link),
wireframe 23; TECH_DESIGN §2 permission table (Audit log: Admin only) and §3.27 `audit_logs`; PROJECT_PROGRESS row SEC-001
("private.audit_row_change/helper immutable có; Audit Log UX còn thiếu").
Dependencies: none blocking. Builds on the existing helper and RLS in
`supabase/migrations/20261001172628_rls_baseline_audit.sql`. Related: SEC-002 (which events are audited), SEC-003 (RLS tests).

## Scope

In: a read-only Admin page over the existing `public.audit_logs` table, its typed application service, a pure domain
module (filter validation, display helpers), the route + navigation entry, local integration tests and unit tests.

Out (explicitly): any migration, RLS/grant/permission change, generated types, new audit events, changes to
`private.audit_row_change`, exports, retention rules, edit/delete controls, write calls of any kind, new packages or UI
frameworks. The existing table is authoritative; unknown `entity_type` / `action` values are shown verbatim.

## Files

- `src/domain/audit/audit-log.ts` — pure: filter parsing/normalisation, page bounds, access resolution, actor label,
  display-safe payload formatting.
- `src/services/audit.service.ts` — `createAuditService(client)`: `listLogs`, `getDetail`. Validates at the boundary.
- `src/features/audit/hooks/useAuditService.ts`, `src/features/audit/pages/AuditLogPage.tsx`.
- `src/app/routes.ts`, `src/app/router.tsx`, `src/app/AppLayout.tsx` — `/audit-log`, permission `view_audit_log`.
- `tests/unit/audit/audit-log.test.ts`, `tests/integration/audit-viewer.test.ts`.

## Design decisions

- Authorization: route wrapped in `PermissionRoute permission="view_audit_log"` (Admin only in the matrix) and the page
  re-resolves access itself (`resolveAuditViewerAccess`): loading / signed-out / inactive / no-profile / denied render
  a state and never mount the component that owns the queries. RLS (`audit_logs_select_admin`) stays the real boundary.
- Identity: the viewer is keyed by `userId:roleCode` and every query key starts with it; there is no placeholder data
  between pages, so nothing from a previous account can render. Filter apply / clear resets the page and collapses details.
- Reads: `created_at desc, id desc` (deterministic with equal timestamps from one statement), `range` of `pageSize + 1`
  rows to know whether a next page exists, page size default 50 and hard cap 100, page capped. List rows omit
  `before_data`/`after_data`; the detail is fetched only when a row is expanded.
- Filters (exact match via `.eq`, never `.or()`/filter strings): entity type, action (restricted charset, ≤ 64 chars),
  actor (profile uuid chosen from a list), record id (uuid), date from/to (Vietnam calendar days, inclusive, converted to
  an exclusive UTC window). All validated again inside the service.
- Rendering: only React text nodes (no raw HTML). Before/after JSON passes through a display-only redaction of keys that
  look like secrets (`secret`, `token`, `password`, `api key`, `hmac`, `authorization`, `signature`) and a size cap.
  The stored row is never altered. Unknown actions are not translated or narrated.
- Actor: profile name when resolvable; no `actor_user_id` is labelled "Hệ thống / không có người dùng" (service role,
  Auth admin, migrations — not claimed to be a person); an id without a readable profile is "Người dùng không xác định".
- Related-entity link only where the recorded `entity_type` is exactly the table name of a screen that exists
  (`orders`, `transfers`) and an id is present; every other entity has no link.

## Acceptance → evidence

1. Only an active Admin mounts/queries; denial states; nav visibility → unit `resolveAuditViewerAccess` over every
   access state and role; integration: every other role, inactive user and anon read nothing (RLS is the boundary).
2. Typed service, bounded stable pagination, filters validated, injection-shaped input rejected before any request,
   unknown values readable → integration `audit-viewer.test.ts`, unit filter tests.
3. Safe display, no write controls → unit formatting/redaction tests; the page has no mutation hook and the service
   exposes only read methods (asserted).
4. States, reset on identity change, mobile layout → implemented in the page; **not** browser-verified (no browser tool in
   this attempt); 320 px is by construction (single column cards, `break-words`/`overflow-x-auto`).
5. Local integration coverage → `tests/integration/audit-viewer.test.ts`, executed only through `task:finish`.

## Tests

- Unit (`tests/unit/audit/audit-log.test.ts`): filter normalisation and rejection, date window math, page bounds, access
  resolution, actor label, redaction/formatting.
- Integration (`tests/integration/audit-viewer.test.ts`): Admin sees rows with real actor/action/before/after from a
  master-data change; ordering and paging across equal timestamps without duplicates or gaps; bounds and invalid input;
  every non-Admin role/inactive/anon sees nothing; direct writes stay impossible and the service has no write method;
  unknown action/entity values with markup round-trip verbatim.

## Honest limits

No browser, no mobile device, no Auth-through-UI, no staging, no Owner acceptance. Local checks are run by `task:finish`.
