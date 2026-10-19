# INF-013 — Local reviewed branch integration

## Scope and dependencies

Integrate existing reviewed local tips in an isolated worktree, starting at COM-002 `a1ff658`. Merge SEC-001 `64dd702` (which already includes TRF-002), ORD-014 `9d35bb2`, and SEC-004 `b9c5448`. Keep their code, migrations, append-only reports, and registry statuses. No new business behavior, direct `develop`/`main` write, Production data, staging deployment, or INF-008 repository-runner activation.

Inputs are locally reviewed, but the task reports remain `needs_validation`. The shared pre-pipeline ancestry also lacks complete task-level provenance and acceptance. This task can establish an integrated local source/check result, not mark those tasks Done or clear release gates.

Codex owns `INF-013`, branch `codex/inf-013-local-integration`, and this worktree only. Integration write scope: the new INF-013 plan/implementation-plan entry and generated task report/registry/STATUS, plus conflict resolution in `docs/handoff/tasks.json` and `docs/handoff/STATUS.md`. Feature source is merged from immutable branch tips; any new source fix requires a scoped finding and fresh validation. INF-008 remains separately owned, including its controller/package work.

## Integration procedure

1. Confirm tip hashes, clean source worktrees, task registries/reports, no active worker or DB lease, and no overlapping runtime paths.
2. Start INF-013 through the shared task pipeline before branch merges. Merge SEC-001, ORD-014 and SEC-004 without squashing or rewriting their reports. Resolve task registry conflicts by exact semantic union: preserve all 23 prior task records and INF-013's in-progress record. Never promote `needs_validation`.
3. Compare the integrated tree with each input tip, verify migration order and source ownership, then run only the checks appropriate to the new integrated head through `task:finish` with `CHB_DB_LOCK_PATH`.
4. Preserve failure evidence if checks or external acceptance remain incomplete. Commit the source, plan, generated report, registry, and STATUS together only after review. A PR and release require separate current-head CI, protection, mobile/browser, staging, and Owner acceptance.

## Acceptance evidence to record

- Tip/ancestor hashes and merge conflicts; no runtime path discarded.
- Registry has 24 distinct task records after INF-013 is added, with the 23 input statuses unchanged.
- Latest INF-013 report's source fingerprint matches the integrated head; report states actual pass/fail/not-run checks.
- `git diff --check`, no secret files, no unrelated manual source changes.
- External CI/PR review, authenticated mobile flow, staging and Owner acceptance remain explicitly pending unless actually observed.

## Local composition evidence — 18/10/2026

- Source: COM-002 `a1ff658`; SEC-001/TRF-002 `64dd702`; ORD-014 `9d35bb2`; SEC-004 `b9c5448`; common checkpoint `60cdcd6`.
- Merge commits: `e385770`, `f4f764a`, `cef77a5`. Conflicts were limited to `docs/handoff/tasks.json` (all three merges) and `docs/handoff/STATUS.md` (ORD-014). Registry resolution rejected any differing pre-existing task record, added only TRF-002, SEC-001, ORD-014 and SEC-004, and regenerated STATUS from the same task index rule as the pipeline.
- Source path comparison: 95 of 96 paths unique to one input tip match that tip's Git blob exactly in the integrated tree. The sole expected exception is the implementation plan, which adds INF-013. The only shared paths are generated registry and STATUS. All 23 input task records match their source branch values exactly; INF-013 is the 24th record and remains `in_progress` until `task:finish`.
- `git diff --cached --check` passed for every merge; targeted Prettier check passed for the new plan and implementation-plan entry. No feature source was edited by the integration owner.
- Read-only Docker check found the Desktop Linux engine pipe absent (`dockerDesktopLinuxEngine`), with no shared DB lease. The final task pipeline must use its explicit `CHB_DB_VALIDATION_BLOCKER` mechanism so DB reset, pgTAP and integration are recorded `not_run`; no startup or reset retry on this unchanged condition.

## DB validation retry — 19/10/2026

- New read-only server evidence: Docker 29.6.2 reports Linux, `supabase_db_chb-ban-hang` is healthy, and the shared DB lease is absent. The integrated source remains at `3b08771`; all 280 paths in the previous report still match its fingerprint.
- A new INF-013 `task:start` attempt is active in this same worktree. `task:finish` will own the shared `CHB_DB_LOCK_PATH` and run local reset, pgTAP and integration. A healthy container alone is not validation evidence; the generated report must record the actual results and lease release.
- The new `task:finish` report `INF-013-2026-10-19T04-39-22-754Z` records pass for pipeline, lint, typecheck, unit tests, build, format, env, DB reset, pgTAP (533 assertions across seven files), and integration (372 tests across 26 files). The lease was acquired and released by PID 25156; no DB lock or test child remains. The task stays `needs_validation` because integrated mobile, staging, independent current-head review, CI and Owner acceptance are outstanding.
