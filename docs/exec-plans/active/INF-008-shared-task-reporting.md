# INF-008 — Shared task reporting extension

Requested 2026-10-02: review the repository, create a Claude continuation prompt,
and a shared reporting pipeline after each task.

## Scope

- Audit current source/specifications and record security/integrity findings.
- Inventory every canonical implementation-plan task without claiming local code is Done.
- Add local task start/finish/status/verify commands, append-only MD/JSON reports,
  and a CI gate for current-source evidence.
- Add Claude instructions and handoff documents; extend AGENTS.md for both agents.
- No business feature fixes, migration, account provisioning or deployment in this task.

## Acceptance and validation

- Task completion attempts produce a durable report even when checks fail.
- Failed/unrun checks cannot be labelled pass; local validation cannot claim staging/UAT.
- Pipeline rejects unknown task IDs, overlapping active tasks and stale PR evidence.
- Tests exercise a failed DB reset, missing/stale reports and secret redaction in fixture logs.
- Run lint/typecheck/unit/build/format/env/pipeline tests and local DB reset.
- Run pgTAP/integration only after a successful local DB reset.

## Status

Implementation prepared. Docker was initially stopped; starting Docker Desktop and
Supabase resolved the local environment limitation. Local DB reset, 111 pgTAP assertions
and 231 integration tests now pass. See the latest generated INF-008 report for all checks.
Keep this plan active until applicable PR review and staging gates pass.

First pipeline attempt recorded a fixture failure: git rm removed the now-empty src
directory before the replacement-file assertion. The fixture recreates that directory;
all four pipeline regression tests then pass. The failed report remains immutable.
The second attempt records full current-source checks and the Docker limitation.
The final attempt runs against the available local stack; prior failed reports are retained.

## Staging CI gate (RV-10, claude attempt 2026-10-03)

Scope: `.github/workflows/staging.yml` only (CI and production workflows untouched), new
`scripts/staging-gate.mjs`, `tests/pipeline/staging-gate.test.mjs`, STAGING_DEPLOY runbook.

- Before: staging `db push` ran on every develop push/dispatch independent of CI (RV-10).
- Now: `gate` job (read-only token, no secrets, no environment) requires that the staged SHA
  is the current develop tip and that jobs `app` and `database` of workflow `CI` (`ci.yml`, push
  event, same repo/branch/SHA) succeeded; the newest attempt decides. Push waits up to 45 min
  for CI; manual dispatch does not wait. `db-push` needs `gate`, keeps `environment: staging`,
  checks out the verified SHA, re-checks `HEAD`, and scopes secrets to the supabase steps.
- Fail closed: missing/unfinished (after deadline)/failed CI, missing job, wrong SHA, stale tip,
  wrong ref/event, fork or PR runs, API errors. No PR trigger, no ref/SHA input.
- Local evidence: `npm run test:pipeline` covers the decision matrix (green, missing, failed,
  wrong SHA, stale, wrong branch, fork/PR runs, re-run precedence, poll/timeout, manual path) and
  structural assertions on the workflow YAML (permissions, concurrency, environment, secrets
  scope, exact-SHA checkout) plus drift between `REQUIRED_CI_JOBS` and `ci.yml`.
- Not verified: no GitHub run, API call, dispatch or deploy was made. Live validation, the
  `staging` environment reviewer/branch rules and develop branch protection (RV-14/SEC-011,
  which is separate from this gate) remain Owner actions. Keep this plan active.

### Gate correction after review (2026-10-03, same task attempt)

Review finding (P2): the develop-tip and latest-CI check ran only before the staging environment
approval, so an approval that came hours later could still push migrations for a commit that was
no longer the tip or whose CI had been re-run.

- `gate` now also exports `ci_run` (CI run id, run number, attempt of the verified run).
- `db-push` (starts only after the approval) runs `scripts/staging-gate.mjs` with
  `GATE_RECHECK=true` twice: before the first privileged command (`supabase link`) and right before
  the writing `supabase db push` (after the dry run). The recheck never waits and requires the
  verified `sha` and `ci_run`; any change of the develop tip or of the newest CI attempt (even to a
  green one), a missing, unfinished or failed run, an unreadable tip or an API error is a denial.
- Least privilege: `db-push` gets `actions: read` (read-only) in addition to `contents: read`;
  the token is given to the two recheck steps only, never to `npm ci` or the supabase steps, and
  the recheck steps hold no staging secret. Environment approval, exact-SHA checkout,
  `concurrency: staging-db` and the absence of PR triggers/inputs are unchanged (tests assert them).
- `parseGateEnv` (exported, tested) validates the recheck settings and fails closed when the
  expectation is missing or malformed.
- Regression tests in `tests/pipeline/staging-gate.test.mjs` (38 tests in the file): approval delay
  with branch advance, newer green/red/running/queued CI attempt and re-run attempt, the verified
  attempt turning red or incomplete, malformed expectation, no waiting, and structure of the two
  recheck steps (order relative to `npm ci`, `link`, dry run and apply; token scope; no secrets).
  A mutation that disables the attempt comparison makes the newer-attempt test fail.
- Still not verified: no GitHub run, API call, dispatch or deploy; the real timing of the
  approval, the `staging` environment rules and develop protection are Owner actions.

The first task:start runs after the pipeline exists; its preExistingChanges lists
the bootstrap edits. They originated in this requested audit/reporting task; no
user edits existed at the initial git status (HEAD 9548886).
