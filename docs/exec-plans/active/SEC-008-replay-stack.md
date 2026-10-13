# SEC-008 — Webhook idempotency replay test on reviewed stack

## Dependency and scope

Canonical E13 SEC-008 verifies E06/PAY-007/008 webhook idempotency. PRD repeated-webhook scenario, TECH_DESIGN payment invariants and AGENTS payment/security rules apply. Parent commit `60cdcd6e7e24b7601167fdb63a3987aa72cfe921` contains the reviewed payment foundation and validated local security additions. The target test path was absent there. No Claude workspace, dirty primary source, webhook implementation, RPC, schema, contract or shared configuration is edited.

The only source addition is `tests/integration/webhook-idempotency.test.ts`, copied after `task:start` from the closed SEC-008 isolated attempt. Its SHA-256 `a4211b72578fc8d86b56f9484a370d3983c0bae786aa4718a956fe5b118b6b62` matches that attempt's immutable report. The test configures its own synthetic receiving account and uses the established `P-` fixture namespace.

## Acceptance

- Replaying a provider event with changed payload does not alter its stored identity or double-credit an order.
- An oversized amount is recorded as ignored; a corrected same-ID replay stays duplicate and creates no credit.
- Concurrent conflicting-order deliveries of the same provider event yield one accepted credit only.

## Validation and limits

Run a fresh `task:finish` under the shared `CHB_DB_LOCK_PATH` lease; use no direct DB command. Review the immutable report, source hash, full-suite check rows and diff. This proves only local composed-tree behavior. Provider Test Mode, separate CHB staging, remote CI and Owner acceptance remain pending. Do not mark Done, copy into the dirty primary, commit, merge or deploy.

The fresh immutable report `docs/handoff/reports/SEC-008-2026-10-12T16-42-28-287Z.json` finished at 16:47:40 UTC. All 12 local check rows passed, including shared-lease DB reset, pgTAP and 347/347 integration tests across 25 files. The test's report hash matches the current file and `git diff --check` found no whitespace issue. The pipeline command returned exit 1 solely because acceptance remains deliberately unverified, so the task is `needs_validation`. No unchanged local retry is warranted; obtain CI, provider Test Mode/staging and Owner evidence before completion.

## 13/10 reviewed checkpoint

Source and checked parent match the immutable report above. The owner authorized feature-branch checkpoints in the orchestration request; earlier preserve-without-commit guidance is superseded for this reviewed checkpoint. Commit unchanged source, existing reports and registry together on `codex/sec-008-reviewed-checkpoint`. No source edit or new validation run. Preserve report status needs_validation and all remaining external/DB gates; this is not Done or merge authorization.
