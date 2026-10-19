# INF-008 primary integration assessment (read-only)

Date: 2026-10-04 · Reviewer: Claude (primary workspace, read-only) · Scope: `tmp/INF008-integration-review/` package vs live root `D:/Projects/chb-ban-hang`. Candidate report reviewed: `INF-008-2026-10-04T01-16-28-080Z` in `C:/Users/HP/.codex/worktrees/inf008-integration/chb-ban-hang`.

No source, registry, report or DB was touched. No task was started or finished. Only this file was written.

## Verdict

**Acceptable to integrate after fixing D1 and D3 (or explicitly accepting them), via the procedure at the end.** The generated-types content is correct for the migrations. The hook is opt-in and fails closed on most paths. Two gaps remain: lifetime handling after a failed generation (D1) and missing machine-checkable lease evidence (D3). The candidate report is `needs_validation` by design (`not_verified` acceptance), so it cannot certify the root.

## What I verified

| Item                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root state still matches the manifest                                 | Root `tasks.json` has 0 `in_progress` tasks. Root has no INF-008 report newer than `2026-10-03T14-59-29`. Migration file sets are identical by name (29 in root, 29 in candidate).                                                                                                                                                                                                                                                                                                                                 |
| Generated types vs migrations                                         | The patch adds exactly three objects: table `delivery_stock_allocations`, RPC `allocate_delivery_stock`, RPC `delivery_allocation_status`. All three come from `20261003080000_delivery_source_allocation.sql`. Columns, nullability and the four FKs (`profiles`, `deliveries`, `locations`, `order_items`) match the migration. `allocate_delivery_stock(p_delivery_id uuid, p_allow_below_safety boolean default false) returns jsonb` is typed `Args {p_allow_below_safety?, p_delivery_id}`, `Returns: Json`. |
| No other public surface missing                                       | `20261004090000_delivery_allocation_coverage_cap.sql` only replaces `private.delivery_stock_coverage`, so no types change is expected. `delivery_item_batches`, `deliveries.dispatched_at` and `delivery_schedule` are already in the root types. Root has 8 matches for the probe set and the candidate has 11, the difference being exactly the three new objects.                                                                                                                                               |
| Types are consumed                                                    | `src/services/deliveries.service.ts` already references the new objects, so the root's types are stale relative to its own source.                                                                                                                                                                                                                                                                                                                                                                                 |
| Generator shape                                                       | `scripts/generate-db-types.sh` writes raw `supabase gen types typescript --local` stdout, and `.prettierignore` excludes the file. `installGeneratedTypes` (same bytes, plus a trailing newline if absent) is equivalent.                                                                                                                                                                                                                                                                                          |
| Hook patch applies to the current root version of `task-pipeline.mjs` | Hunk context matches root lines 3-8, 176-182, 202-300.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Test count                                                            | Patch adds 8 `test()` blocks, and 50 + 8 = 58 matches the README's 58 pipeline tests. The report prose says "20 pipeline regressions"; that is assertions, not tests. Fix the wording when copying.                                                                                                                                                                                                                                                                                                                |

Not verified by me: SHA-256 equality of the 4 root files in the manifest. `git hash-object` was denied in this read-only mode. The integrator must recompute (procedure step 1).

## Source freshness logic (`finish()` in the patch)

Correct:

- Default finish (no `--generate-types`) keeps `stableBase = sourceBefore`, so behaviour is unchanged.
- Generation runs only after a passing `db reset`, only if `CHB_DB_LOCK_PATH` is set, and only if `dbLifetimeUncertain` is false.
- Each segment is compared separately: `sourceBefore` to `preGen`, then `preGen` to `postGen`, then `postGen` to final `source`.
- The types file is excluded only in the generation segment, and only when installation succeeded.
- Final `source`, `sourceDigest` and `filesChanged` cover the new types because the last snapshot is taken after the app rechecks.
- The five app checks rerun after the lease is released when the file changed.
- Install is write-temp then rename, never truncating the target. The validator rejects empty output, NUL bytes, credential-like text, syntax errors, non-type top-level statements and non-literal `Constants`.
- A temp file `database.generated.ts.<pid>.tmp` is untracked and exists only inside the generation window. No snapshot is taken then.

### D2 (P3) A concurrent edit to the types file in the generation window is masked

`changed(preGen, postGen).filter(file !== generatedTypesPath)` drops the types file whenever `installed` is truthy, even if `installed.changed === false`. In that case any other writer to the file during the window is invisible. Fix: assert `postGen[generatedTypesPath] === sha256(LF-normalised installed body)`, which equals `installed.sha256`, and treat a mismatch as unstable. Add a test where the generator also rewrites the types file differently.

## Ownership and lifetime evidence

Correct:

- `acquireDbValidationLock` creates the lease with `openSync(path, 'wx')`, rejects symlinks, rejects borrowed leases, requires an absolute path, and releases only if `token` and `pid` match. A foreign lease is never removed.
- The lease is held from before `db reset` through pgTAP and integration (the `finally` releases it).
- A timeout or error during reset, pgTAP, integration or `gen types` sets `dbLifetimeUncertain`, and the lease is then retained.
- App rechecks run after release, so they never extend the lease.

### D1 (P2) After an uncertain `gen types` the DB tests still run

In `generateDbTypes()`, a timeout, signal or `error` sets `dbLifetimeUncertain = true` but not `dbReady = false`. `runCheck` does set `dbReady = false` for the same condition. The pgTAP and integration guard is `!dbReady`, so both still run against a database whose `supabase gen types` descendant may still be alive. The lease is retained afterwards, but the checks have already run. The retained-lease message therefore contradicts the evidence. Fix: set `dbReady = false` in `generateDbTypes` when lifetime is uncertain, so pgTAP and integration become `not_run`. Add a regression test with a hanging or timed-out generator.

### D3 (P2) The report has no checkable lease or ownership evidence

- No check row records lease acquisition, owner pid, token hash or `createdAt`, or release outcome. Success is visible only as the absence of `db lease retained`.
- The candidate's lifetime claims are free text, so they are not machine-checkable. Examples: "shared lease absent before finish", "External CHB session end_turn unchanged since 13:48Z; only conhost child".
- `CHB_DB_LOCK_PATH` being set is checked, and ownership is real once the path is set. But `acquireDbValidationLock(undefined)` returns a no-op release, which is why the explicit guard exists. The guard works; the evidence of it is only in the log.

Fix (cheap): on acquisition, add a passing `db lease` check with `command: 'exclusive local DB lease'` and a reason like `owned pid=<pid> token=<first 8 chars of sha256> at <createdAt>`; on release add a similar `db lease release` row. Keep the full token out of the report. Add a test that asserts both rows exist for a generating run.

## Other findings

- **D4 (P3):** the candidate report has an empty `Branch:` (detached worktree) and lists only `src/types/database.generated.ts` under "Files changed". Both are expected, because the hook files were in the baseline at `task:start`, but neither is reusable evidence. A root finish will list the real delta and carry the root branch and HEAD.
- **D5 (P3):** the candidate's package covers only 6 listed paths. `baseline.json` listed 3. The manifest's claim that the rest of the tree is identical to root is not backed by a whole-tree comparison in the package. The integrator must diff the full tree, not just those files (step 2).
- **D6 (P3):** `docs/handoff/WORKFLOW.md` and `docs/exec-plans/active/INF-008-integration.md` are under `docs/`, so they are outside the source digest by design (`governed()`). Review them separately. The plan text includes point-in-time claims ("PID33764 has only conhost child") that belong to the candidate's session, not the root. Trim them on copy.
- **D7 (info):** `typescript` is imported at runtime by `scripts/db-types.mjs`. It is a devDependency (`~6.0`); fine for `npm ci`, but `task:finish --generate-types` fails without dev dependencies installed. Say so in WORKFLOW.md.
- **D8 (info):** on PowerShell the npm shim can drop `--generate-types`; the package documents `npm.cmd`. The positional-argument change (`args.find(a => !a.startsWith('--'))`) is correct.

## Next safe integration procedure (no copy into the live primary from this review)

1. **Recheck baseline.** In root, recompute SHA-256 for the 4 existing manifest paths and compare to `rootSha256`. Also confirm `scripts/db-types.mjs` and `docs/exec-plans/active/INF-008-integration.md` do not exist in root. Any mismatch stops the process.
2. **Recheck scope.** Confirm root `tasks.json` has no `in_progress` task, no coordinator dispatch is running, no other worker holds `CHB_DB_LOCK_PATH`, and no Desktop child is running. Diff the full root tree against the candidate's tree (excluding `tmp/`, `docs/handoff/reports`, `tasks.json`, `STATUS.md`), not only the 6 manifest paths. Any unexpected file is a blocker.
3. **Resolve D1 and D3 first, in the candidate worktree**, by whoever owns it. That means a new candidate task attempt and a refreshed manifest. D2 and D6 can ride along. Re-review the resulting patches against root hashes.
4. **Apply through a primary task, not by copying from this session.** A separate primary task (`task:start` for INF-008 or its successor) applies the reviewed patches to the exact baseline. Review the actual `git diff` against the patch files before `finish`.
5. **Lease-owned validation.** Primary `task:finish` runs with `--generate-types` (use `npm.cmd` on PowerShell) and owns the shared lease throughout reset, generation, pgTAP and integration. Confirm the printed child command includes `--generate-types`. No direct DB commands.
6. **Evidence checks on that report.** Every check passes, including the five `... after types` rows. The `generate types` row shows `Unchanged`: the root types already contain the three objects once step 4 applies the types patch, so the pipeline should find them identical. A `Updated` row means the root types still differ from the migrations and must be reviewed. The lease rows from D3 are present. There is no `db lease retained` and no `source stability` row.
7. **Preserve** all historical reports, both registries and the candidate worktree. The candidate report remains a digest only, never a substitute for primary-tree validation.
8. **Status.** Even with a clean report the result is `needs_validation` unless every acceptance item is `met`. Real GitHub/staging validation and `develop` protection stay `not_verified`. No commit, merge, push or deploy comes from this assessment.
