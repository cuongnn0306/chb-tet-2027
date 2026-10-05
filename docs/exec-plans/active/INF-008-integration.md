# INF-008 lease-owned generated-types integration (primary)

Integrates the reviewed, opt-in `task:finish --generate-types` hook into the primary checkout. The
reviewed package is `tmp/INF008-integration-review/` (manifest of seven files); the candidate
validation that produced it ran in an isolated worktree and is a digest only. This plan describes
what the primary integration does and what is verified, not the candidate's pending text.

## What changed (seven paths only)

- `scripts/db-types.mjs` (new): validates `supabase gen types typescript --local` output (valid
  TypeScript, only type declarations, an exported `Database` type and a literal `Constants` object;
  no secrets/NUL/empty) and installs it by write-temp + rename; returns `lfSha256`.
- `scripts/task-pipeline.mjs`: `--generate-types` opt-in. Default finish never generates types.
  Generation runs only after a passing local reset, only when `CHB_DB_LOCK_PATH` is set and the
  lifetime is certain; blocked, failed-reset, lease-unavailable and no-lease cases are `not_run`.
  Changed types trigger lint/typecheck/tests/build/format again after the lease is released.
  Source freshness is checked per segment; the types file is exempt only for the exact bytes
  installed (LF fingerprint), so a concurrent edit is still reported as `source stability`.
- `scripts/db-validation-lock.mjs`: `release.lease` (pid, createdAt, first 8 hex of sha256(token),
  never the token) and `release()` returning `released`/`absent`. Borrowed leases stay unsupported.
- `tests/pipeline/task-pipeline.test.mjs`: mock-CLI regressions for default no-generation, ordering,
  lock held / failed reset / blocker / no lease, invalid or executable output keeping old bytes,
  validator accept/reject cases, unrelated source mutation, hung generator (DB checks `not_run`,
  lease retained), concurrent edit of the types file, lease evidence rows without the token.
- `src/types/database.generated.ts`: adds `delivery_stock_allocations`, `allocate_delivery_stock` and
  `delivery_allocation_status`, matching `20261003080000_delivery_source_allocation.sql`. No other
  public surface changed (`20261004090000` only replaces a private function).
- `docs/handoff/WORKFLOW.md`: documents the opt-in, dev-dependency requirement, lifetime rules,
  lease evidence rows and the PowerShell `npm.cmd` note.
- This plan.

No migration, schema, RPC, RLS, other source, workflow, report or registry file is part of this change.

## Procedure and ownership

DB commands run only inside the owning `task:finish`, which holds the shared lease from reset
through pgTAP/integration. No direct DB commands, no borrowed or exclusive lease. Run:
`npm run task:finish -- INF-008 tmp/INF008-primary-summary.json --generate-types` and confirm the
printed child command includes `--generate-types`. A `db lease` row and a `db lease release` row
(`released`) are expected, and no `db lease retained` or `source stability` row. Expected types row:
`Unchanged` (the types in this change already equal generator output) or `Updated`, which would mean
the types diverge from the migrations and need review.

## Status and limits

Local tooling acceptance is established by the fresh primary report for this attempt (see the latest
INF-008 report); it is `needs_validation`, not Done. Real GitHub/staging validation of the staging
gate and `develop` branch protection remain `not_verified`. Nothing here deploys, commits or merges.
