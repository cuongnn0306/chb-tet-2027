# SEC-004 — Compose reviewed env and Git secret scanners on the validated stack

## Dependency and scope

Implementation plan E13 SEC-004 (secret scan) is a heading only; acceptance comes from the
owner task prompt and PROJECT_PROGRESS (`SEC-004 partial: full secret/history/mode scan chưa
có RV-11`). Baseline 60cdcd6 is an explicitly reviewed composed continuation; origin/develop
is foundation-only and is not rebased onto or claimed integrated.

This is a composition of closed reviewed work, not a new scanner. Eight source/test inputs
staged by the coordinator under `tmp/sec004-reference/` were verified against
`input-manifest.json` (SHA-256, before and after integration; all eight identical) and
written to the same repository-relative paths. The original source worktree was not touched.

| Path                                     | SHA-256                                                          |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `scripts/check-env.ts`                   | 2c71fc836f503d09528555c330cafeb811d4e39328e018431aed39b20ad3bb8a |
| `scripts/env-scan.mjs`                   | 244bf48fbc6922c31c44b1e8f430b02239bacba06ca1370b3533aa9e3157dd8a |
| `scripts/env-scan.d.mts`                 | 1a2b6194400097136e58e10edc87a4865080f36d718a3f510b25302d85cc8f39 |
| `scripts/secret-scan.mjs`                | 22f2040a1d0d8dc7f0e5683fc695e3077f6764ef7f9668da08847ba6913dff14 |
| `scripts/secret-scan.d.mts`              | cea1678693f3b1a5bb0cf221f9a3c2d4fe4f8d702f0e8c936526caba76e24c80 |
| `scripts/secret-scan.allowlist.json`     | f69be72b24e7af782ca11c3b66f4a4cdb6f2ba8ade32e1892135be18eadce0d8 |
| `tests/unit/scripts/env-scan.test.ts`    | 97e45adb874a6ed2f3cf05216a51288b5d20a649e935374bf09e2d7b8263dbdf |
| `tests/unit/scripts/secret-scan.test.ts` | 88c6f5b830eabe9ddfb87a0f197e16b02516f15076748fadfc946dd99b693b82 |

Also integrated: `docs/runbooks/SECURITY_CHECKS.md` (only its dated scan-scope section was
updated with this attempt's real counts and the deliberate skip rules read from the source),
`package.json` (one line: `check:secrets` = `node scripts/secret-scan.mjs`) and
`.github/workflows/ci.yml` (one step: `npm run check:secrets` after `npm run check:env`;
every existing gate, `fetch-depth: 0` and setting preserved). No dependencies, migrations,
types, RPC/RLS, business/auth rules or webhook code changed.

## Behaviour (as reviewed, unchanged)

- `check:env`: loads `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local` for
  development/production/staging with Vite precedence (`process.env` > `.env.[mode].local` >
  `.env.[mode]` > `.env.local` > `.env`), expands `${VAR}`, flags server keys under
  browser-exposed names, forbidden names, invalid `VITE_APP_ENV`, tracked env files,
  `.env.example` secrets and unsupported `envPrefix`/`envDir`. Values are never printed.
- `check:secrets`: scans tracked + untracked-not-ignored files line by line and every added
  line in local history via `git log --all -m -p -U0`, so merge-only additions and later
  deleted secrets are found. Output is rule id, path:line, 12-char commit, 10-hex
  fingerprint. No inline suppression; one reviewed rule+fingerprint allowlist entry (a
  synthetic `FAKE_API_KEY` test fixture), reason required.

## Review of existing scanner against current code

Read `secret-scan.mjs` / `env-scan.mjs` against the current tree. No defect was reproduced, so
no scanner code and no new regression was added. Observations only (not changed, outside the
"actually reproduced defect" rule):

- `SKIP_PATH` skips any path with a `node_modules`, `dist` or `coverage` directory, even if
  Git tracks it; NUL-containing files are counted as binary and not scanned. Documented in
  the runbook scope section so a clean result is not read as covering them.
- `git log --all` covers local refs including already-fetched remote-tracking refs; it never
  contacts a remote, so unfetched remote/fork refs are outside this check.

## Evidence (pre-finish)

- `npm run check:secrets`: working tree 486 files (1 binary skipped), 52 local commits, 0
  findings, exit 0, metadata-only output.
- Scoped `npx prettier --check` on every allowed file: pass.
- Lint, typecheck, unit, build, format, env and pipeline run only through `task:finish`.

## Evidence (task:finish)

Report SEC-004-2026-10-13T04-59-17-385Z, status `needs_validation` (exit 1 expected):
pipeline, lint, typecheck, unit tests (including both scanner test files), build,
format:check and `check:env` all pass. DB reset, pgTAP and integration are `not_run`
because the Docker Linux engine is unavailable and the coordinator blocker is present; they
are not claimed as passed. The `check:env` pass covers process.env and the env files present
in this worktree only, not the primary checkout's ignored env files.

## Not verifiable in this isolated workspace (pending)

- Ignored env files of the primary checkout (`npm run check:env` there, by the Owner).
- Remote, fork and unfetched PR refs; Vercel/Supabase hosted secret stores; CI artifacts.
- GitHub CI run of the added step; independent review of the diff.
- DB reset, pgTAP and integration: Docker Linux engine unavailable; `task:finish` skips DB
  while the coordinator blocker is present. No Done, merge or deploy certification.

# 13/10 independent follow-up

Composition checks passed but independent review reproduced an inherited authenticated-JWT scanner false negative. See `docs/reviews/2026-10-13-SEC004-composition-review.md`. Preserve this report/checkpoint, then resume the exact session for a fresh scoped SEC-004 attempt with source/env synthetic regressions. Keep external and DB gates pending; do not claim Done.

# 13/10 authenticated JWT correction (second attempt)

Scope: `scripts/env-scan.mjs`, `tests/unit/scripts/env-scan.test.ts`,
`tests/unit/scripts/secret-scan.test.ts`, this plan and the runbook. `env-scan.d.mts` needed
no change (`rule` stays `string`). No package, CI, allowlist, dependency or other-script change.

Reproduced defect (from the independent review, confirmed by reading the code): the JWT loop in
`findSecretShapes` did `continue` for `role === 'authenticated'`, so a user session token was
invisible to `scanText` and to `evaluateBrowserVar` under any name. Supabase documents user JWTs
as bearer access tokens, distinct from the public anon/publishable keys.

Fix: `authenticated` now yields rule `jwt-user-session`; anon stays exempt; JWTs without a
`role` claim and malformed JWTs keep their previous behaviour. In browser variables the new
code is `user-token-in-browser-var` with a Vietnamese message naming only the variable, the
rule description and file:line. The role is decoded for classification only; the signature is
never verified and no fixture is authenticated. Allowlist untouched: it is keyed by
rule+fingerprint, so the existing entry cannot hide the new rule (regression-tested).

Behaviour change to an existing test: a `jwt('authenticated')` in `VITE_SUPABASE_ANON_KEY`
used to report `not-anon-key`; it now reports `user-token-in-browser-var` (a stronger,
more accurate finding). `not-anon-key` stays covered with a JWT lacking a role claim.

Regressions added (tokens assembled at runtime with synthetic claims/signature): env-scan —
authenticated JWT under three VITE names with redacted diagnostics, anon unaffected, `scanEnv`
on `.env.production.local` with mode and line; secret-scan — generic source literals and
`Bearer` header, anon not flagged, service-role allowlist entry does not hide it, tree + CLI
exit 1 + redaction, deleted-then-found-in-history with the introducing commit.

Evidence before finish: `npm run check:secrets` under the stricter rule — 491 working-tree
files (1 binary skipped), 53 local commits, 0 findings, metadata only. Scoped Prettier on owned
files applied. A direct `vitest` run was not on the command allowlist, so the unit tests are
executed only by `task:finish`.

Finish result — report SEC-004-2026-10-13T08-15-47-066Z, `needs_validation` (exit 1 expected):
pipeline, lint, typecheck, unit tests (including the new regressions), build, format:check and
`check:env` pass. DB reset, pgTAP and integration are `not_run` (Docker Linux engine
unavailable, coordinator blocker present) and are not claimed. Pending and outside this
workspace: real browser/auth/RLS behaviour, ignored env of the primary checkout, remote/fork
refs, hosted secret stores, remote CI, staging, independent review. Not Done.

# 14/10 validation-only follow-up (third attempt)

Environment change since the previous DB `not_run`: the coordinator reports the Docker Linux
engine and the local CHB Supabase DB are healthy, no implementation dispatch or DB lease is
active, the stale ignored `CHB_DB_VALIDATION_BLOCKER` was removed and the shared
`CHB_DB_LOCK_PATH` is retained. Immutable report `SEC-004-2026-10-13T08-15-47-066Z` and its 260
source hashes were verified by the coordinator; they are not edited here.

Scope: validation only. Preconditions confirmed before `task:start`: branch
`codex/sec-004-claude-stack`, HEAD `715584b5a51cebf8120d496d79066d82648251a3`, clean worktree.
No implementation source, schema, service contract, workflow switch, permission, allowlist,
package, CI or business rule is changed; this plan is the only tracked file edited by hand.
No ignored env file, credential or real secret value is read; the synthetic scanner
regressions from the previous attempt remain the evidence for scanner behaviour.

Plan: run `npm run task:finish` exactly once. Only the finish pipeline performs the local DB
reset, pgTAP and integration while it owns the shared lease; no direct Supabase CLI,
`db reset`, `test:db` or `test:integration`, and no linked, staging or production database.
A failed DB check is recorded as failed and is not retried in this attempt. Status stays
`needs_validation` because the external gates below cannot be met from this workspace.

Finish result — report `SEC-004-2026-10-14T10-03-34-359Z`, status `needs_validation` (exit 1
expected), checked HEAD `715584b5a51cebf8120d496d79066d82648251a3`, source digest
`ce8b4b9f8910e778fe1b3118dff3a03584368c60f117666c0d5ecd91c53226a8`. Single finish invocation,
no retry:

| Check     | Result | Check            | Result |
| --------- | ------ | ---------------- | ------ |
| pipeline  | pass   | db lease         | pass   |
| lint      | pass   | db reset (local) | pass   |
| typecheck | pass   | pgTAP            | pass   |
| tests     | pass   | integration      | pass   |
| build     | pass   | db lease release | pass   |
| format    | pass   |                  |        |
| check:env | pass   |                  |        |

The DB lease was owned by the pipeline and released normally (`pid=11340`, token prefix
`8944292c`). This supersedes the earlier DB `not_run` rows for the unchanged source; the
immutable 13/10 reports are untouched. `check:env` still covers only `process.env` and the env
files present in this worktree.

Still pending and not verifiable from this workspace, so status stays `needs_validation` and
nothing is Done: hosted/remote secret-scan scope (remote, fork and unfetched PR refs,
Vercel/Supabase hosted secret stores, CI artifacts), `npm run check:env` against the primary
checkout's ignored env files by the Owner, current-head remote CI, staging, real browser/auth/RLS
behaviour, coordinator independent review and Owner acceptance.
