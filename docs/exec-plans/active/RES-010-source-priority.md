# RES-010 — ưu tiên kho nguồn theo vùng, đủ hàng và FEFO

## Scope and dependencies

PRD §14 fixes priority as same region, enough sellable quantity without breaking
safety stock, earlier expiry, then fewer splits. Review RV-08 identified that
`private.transfer_sources` ordered by positional column 5 (`sellable_qty`), not
expiry. RES-005 allocation and the DEL-005 dispatch guard are present in this
worktree. The primary checkout has unrelated uncommitted changes and is untouched.

This attempt starts from the committed DEL-005 branch and integrates the reviewed
RES-010 migration and regression test from the isolated `res010-integration`
worktree. No new RPC signature, state, role, inventory movement or generated type
is required.

## Implementation

- `20261003044700_transfer_source_priority.sql` replaces only
  `private.transfer_sources` with named output expressions. It keeps the existing
  same-region and full-coverage priority, sellable/safety-stock filter and grants;
  then orders by `earliest_expiry ASC NULLS LAST`, `sellable_qty DESC`, code.
- `transfer-source-priority.test.ts` covers region, full coverage, expiry,
  fewer splits, destination/inactive/safety-only exclusion, no ledger movement
  and Production-role denial.

## Acceptance and verification

- Run the repository task pipeline on the combined source under the shared local
  DB lease: lint, typecheck, unit, build, local reset, pgTAP and integration.
- Check scoped formatting, source diff, permission behavior and no secrets.
- Record repository-wide format failures and any mobile/staging/review gaps
  honestly; do not label the task Done without the AGENTS.md DoD.

## Status

After the first combined-source attempt on 11/10/2026, pipeline tests, lint,
typecheck, unit tests, build, env check, local DB reset, pgTAP and integration
passed. Integration ran 23 files / 330 tests, including all five RES-010 cases.
The shared DB lease was acquired and released. Repository-wide format checking
failed on 297 inherited files; the RES-010 test and this plan pass scoped
Prettier. No UI files changed, and final mobile, staging and independent review
remain unverified. The acceptance evidence is recorded in a fresh report after
this plan update; RES-010 is not Done.

The unrelated Windows line-ending check failure was addressed separately under
INF-002 (commit `006d69b`, full local pipeline passed). A fresh RES-010
`task:start`/`task:finish` now verifies the combined source with the standard
repository-wide format check; no RES-010 SQL or test behavior changed.
