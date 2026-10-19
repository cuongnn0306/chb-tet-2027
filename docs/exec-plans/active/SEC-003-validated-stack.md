# SEC-003 — Catalog RLS guard on reviewed stack

## Task and provenance

Implementation plan E13 SEC-003 supplies the RLS suite task. TECH_DESIGN permissions,
AGENTS security/transaction invariants and existing per-role tests are the requirements.
Parent bef4f19 includes reviewed DEL-005/RES-010/INF-002/INF-008/DEL-001 changes; develop
does not yet contain this foundation. Preserve original worktrees and dirty primary files.

Integrate only `supabase/tests/rls_catalog.test.sql` from the closed SEC-003 isolated lane.
Its normalized LF SHA-256 is
`a10e90fa3f8a8aa8f9fad0df411feff4dd84af1766150f19a1338f37c9b13a58`, matching immutable
report SEC-003-2026-10-06T15-32-32-121Z. Target path was absent before copying.
Create fresh plan, task report and registry evidence; never copy another lane's registry.

## Scope and acceptance

Nineteen catalog-only pgTAP assertions check public RLS, anon/client privileges,
the eleven-table master-data write allowlist, policy/view shapes, empty definer search_path
and nine server-only function names/ACLs. Count distinct schema/name pairs, so an extra
overload cannot hide a missing function name. Transaction rolls back without fixtures.
No migration, grants, policies, application behavior or generated public types change.

Independent read-only review found no actionable issue on the composed prerequisites.
Limits: table privileges do not cover column grants; unconditional-policy detection checks
literal true; catalog checks supplement, not replace, per-role behavioral tests. Earlier
mutation evidence is historical and will not be represented as a new mutation run.

## Validation

Fresh report SEC-003-2026-10-12T08-35-04-095Z records all 12 local check rows passing:
62 pipeline tests, lint, typecheck, 263 unit tests, build, format, environment, shared lease,
local reset, 318 pgTAP assertions, 333 integration tests and owned lease release.
No remote DB action. Report status remains needs_validation for the external gates below.
Owner confirms CHB needs a separate, unconfigured staging project. Claude organization
access and Vercel login remain unavailable; continue local work. Current CI, staging and
full security acceptance remain unverified; no Done or merge certification.
