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
