# INF-008 — Concurrent generated-types fixture on Windows

## Scope and dependencies

Investigate the recurring `generate types: fail` assertion in the concurrent-edit fixture,
record the actual failure, and fix only the fixture if it introduces its own filesystem race.
Keep production generation, atomic installation, validation and source fingerprints intact.

Base: `514785d`, the clean committed DEL-005/RES-010/INF-002 lane. Updated `origin/develop`
was fetched, but lacks the pipeline and dependent stack; starting this follow-up there would
discard its prerequisites. INF-008's reviewed hook is committed in `ae74f2e`; this is a new
bounded follow-up, not takeover of the old usage-limited Claude workspace/session.

Owned paths: `tests/pipeline/task-pipeline.test.mjs`, this plan, orchestration plan and generated
INF-008 task reports/registry. No business source, migration, RPC, RLS or CI policy change.
Primary checkout and all other worktrees remain preserved.

## Acceptance

- Capture a diagnostic reason for the existing intermittent failure before selecting a fix.
- Concurrent replacement remains rejected as `source stability`, with `needs_validation`.
- Successful generation is exercised, and the attacker closes its watcher/timer before cleanup.
- No retry or exemption hides a real generation/source-stability failure.
- Run complete task:finish checks; local DB reset/pgTAP/integration only under shared lease.
- Record external/CI limits honestly; no task Done based only on compilation.

## Evidence

12/10 baseline isolated rerun passes 1/1, consistent with the intermittent failure recorded
in DEL-001's 06:43 UTC report and PRD-001's 06/10 review. The second diagnostic repetition
reproduced `Could not install generated types: EPERM ... rename ...tmp -> database.generated.ts`.
The fixture's 1 ms target-read polling kept opening the Windows rename target.

The replacement watches the containing directory and starts emitting CLI output only after
watcher readiness. It reads the target only after a target-name event, then overwrites the
installed bytes and closes watcher/timer before writing the completion marker. The test
asserts actual hijack, successful generation, source-stability failure and needs_validation.
Ten consecutive isolated Windows reruns passed. No production generator/installer code changed.

Independent read-only review found no actionable issues. Its limitation is that the completion
marker proves filesystem work finished, not OS-level process termination, and fs.watch timing
still needs cross-platform CI evidence.

Fresh report `INF-008-2026-10-12T08-18-12-173Z` passes all local checks: 62 pipeline tests,
lint, typecheck, 263 unit tests, build, full formatting, env, local reset, 299 pgTAP assertions
and the full integration suite. The shared DB lease was acquired and released normally.
Status stays needs_validation because cross-platform CI/staging acceptance is not verified.
No production, RLS or business-state change occurred. Keep this plan active for external review.
