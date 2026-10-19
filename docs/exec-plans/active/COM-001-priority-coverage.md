# COM-001 — Commission rule resolution coverage

## Scope and dependency

The E11 COM-001 priority in the implementation plan and TECH_DESIGN §3.22 is User+Product, User, Role+Product, Role, then Product default. PRD §19 bases commission on list price and requires approved rule behavior. The committed parent `60cdcd6e7e24b7601167fdb63a3987aa72cfe921` already has the Admin-managed `commission_rules` table, seeded roles/profiles/products and `private.resolve_commission_rate`. The existing order integration tests cover selected seed overrides, but not all priority steps, effective-window boundaries, inactive rules or zero percent.

This scoped task adds only `supabase/tests/commission_resolution.test.sql`. It uses seeded synthetic Sale B2B and store profiles and HQ-B, adds temporary rules inside a transaction, tests each precedence/date/fallback behavior, then rolls back. No migration, RPC, schema, service contract, UI or shared configuration changes. Claude's reserved TRF-001/INF-008 scopes and all dirty primary files remain untouched.

## Acceptance

- All five precedence levels resolve according to the approved order.
- Effective start and end dates are inclusive; future/expired and inactive rules do not apply.
- An active zero-percent override is honored rather than treated as missing.
- The test leaves the seed unchanged and the existing integration suite still passes.

## Validation

Run `task:finish` with the shared `CHB_DB_LOCK_PATH` lease, then inspect the immutable report, pgTAP output, source digest and full-suite result. All DB validation occurs inside that pipeline. Remote CI and separate CHB staging/Owner acceptance remain external; do not mark Done from local evidence alone. Preserve this isolated worktree without commit, merge, deployment or copying into the dirty primary.

The fresh immutable report `docs/handoff/reports/COM-001-2026-10-12T18-43-51-739Z.json` finished at 18:49:32 UTC. All 12 local check rows passed, including DB reset, 329 pgTAP assertions in six files, and 344/344 integration tests in 24 files. The new test file's SHA-256 matches the report source map; `git diff --check` found no whitespace issue. The pipeline returned exit 1 because acceptance was conservatively recorded as unverified, so the registry remains `needs_validation`. Remote CI, separate CHB staging and final Owner/reviewer acceptance are outstanding; no unchanged local retry is warranted.

## 13/10 reviewed checkpoint

Source and checked parent match the immutable report above. The owner authorized feature-branch checkpoints in the orchestration request; earlier preserve-without-commit guidance is superseded for this reviewed checkpoint. Commit unchanged source, existing reports and registry together on `codex/com-001-reviewed-checkpoint`. No source edit or new validation run. Preserve report status needs_validation and all remaining external/DB gates; this is not Done or merge authorization.
