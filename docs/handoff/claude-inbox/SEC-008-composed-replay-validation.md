# Ready ticket — SEC-008 composed replay regression

This is a prepared ticket, not a running Claude dispatch or completion certificate.
Dispatch only after Owner confirms Claude Code organization access restored, a single
readiness check succeeds, current ownership/dependencies are re-read and one worker slot
is free. Preserve all existing usage-limited sessions and scopes. Maximum two implementation
workers. Do not resume another lane's historical session for this task.

## Prerequisite checkpoint

SEC-005 on `codex/sec-005-validated-stack` must first finish, be reviewed and committed.
It contains reviewed DEL-005/RES-010/INF-002/INF-008/DEL-001/SEC-003/SEC-002 source.
Inspect refreshed origin/develop and actual source before choosing a workspace; do not
silently drop missing foundation commits or copy the dirty primary registry. Record the
chosen baseline/dependency evidence in controller and task plan before task:start.

## Bounded task

Implement one SEC-008 attempt. Target source path:
`tests/integration/webhook-idempotency.test.ts` (absent at b1bb1c5).
Closed source worktree: `C:/Users/HP/.codex/worktrees/sec008-integration/chb-ban-hang`.
Immutable report: SEC-008-2026-10-06T13-11-24-806Z.json, based on 2df547e.
Normalized LF SHA-256:
`a4211b72578fc8d86b56f9484a370d3983c0bae786aa4718a956fe5b118b6b62`.
Verify hash, baseline and ownership again before copying only this test. Create a new
ExecPlan and fresh report/registry; preserve old source and reports. No RPC/Edge/schema edits.

PAY-007 canonical-id processing, PAY-008 uniqueness, localhost-only helpers and sequential
integration config were unchanged through b1bb1c5; SEC-005 has no overlapping scope.
Independent review found no blocker. Test fixture uses corrected P-SEC008- SKU prefix and
the same synthetic receiving account as payment audit tests.

Scenarios: changed amount/order/content replays preserve first event/payment; eight concurrent
conflicting copies yield one credit and seven duplicates, with winner/loser balances correct;
an invalid oversized string is ignored, and a valid retry with the same ID remains duplicate.
Limits: SQL RPC tests do not verify HTTP Edge auth/HMAC/timing or real SePay. Promise.all
does not force overlap. Oversized string case does not establish numeric-overflow handling.

## Required process

Reserve controller scope, then task:start SEC-008 claude with exact scope. Review source,
run task:finish with shared lease `D:/Projects/chb-ban-hang/tmp/claude-coordinator/db-validation.lock`
and timeout zero. All DB commands only inside that pipeline. Include fresh app/reset/pgTAP/
integration evidence and independent review. Commit own source and generated MD/JSON report,
tasks/status and plan together. No merge, Production action, secret, remote testing or
claim of Done without external acceptance. Current CI/staging/provider acceptance is pending.
