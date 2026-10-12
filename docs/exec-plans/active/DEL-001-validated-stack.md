# DEL-001 — Reviewed delivery code fix on composed stack

## Scope and source provenance

New isolated branch `codex/del-001-validated-stack`, parent 01db447. It contains the
committed DEL-005 dispatch gate, RES-010 source ranking, INF-002 Windows format policy
and INF-008 fixture correction. Updated develop lacks these prerequisites; reuse the
reviewed committed stack instead of dropping dependencies. No dirty-primary source is used.

Copy only two closed DEL-001 source files from `del001-committed-base` after verifying
their LF SHA-256 against immutable report DEL-001-2026-10-12T06-43-39-689Z:

- `supabase/migrations/20261005164000_delivery_code_lock.sql`: 63afa0f4fff642d63b3a4ccbf73d318c10794e78bbb7f9e59335c51a94f9a705.
- `tests/integration/deliveries.test.ts`: fc82274d9654b406b7c908763fb63c27eb4773065ce98e760ef0a006604fb180.

The target test must equal its 2df547e baseline before integration. Preserve the original
worktree and reports. No unrelated payment-audit migration, source, RPC/RLS or generated
types is copied. This private trigger body replacement has no generated public type change.

## Acceptance and review

- Valid simultaneous plans both succeed with unique consecutive per-order codes.
- Competing over-quantity plans reject the loser for quantity, not duplicate code.
- Suffixes 100/101 stay distinct, with 101 unique headers and zero-padding for 01–09.
- Existing delete/state/dispatch/source guards remain intact.
- Full task:finish passes on this composed source, with shared DB lease ownership/release.

Independent static review found no actionable issue. Advisory lock precedes counting for
every INSERT and preserves the previous guard's other rules. Inspected transition/allocation
paths do not acquire this advisory key, so no reciprocal lock ordering was found. Tests use
Promise.all (overlap is not forcibly scheduled) and do not explicitly cover rollback reuse.
Do not substitute the earlier 2df547e DB report for this composed-tree validation.

## Validation

Fresh report `DEL-001-2026-10-12T08-25-51-290Z` records all 12 local check rows passing,
including pipeline, lint, typecheck, unit, build, format, environment, exclusive DB lease,
local reset, 299 pgTAP assertions, integration and lease release. The attempt remains
`needs_validation`: cross-platform CI, staging and applicable end-to-end mobile acceptance
are external gates. Do not mark the full delivery task Done from local checks.
