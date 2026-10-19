# COM-002 — review round 1 fix, same lane and exact session

Stay on canonical COM-002 in `feature/COM-002-estimated-commission` and this worktree. Read the current report `docs/handoff/reports/COM-002-2026-10-16T09-36-07-486Z.json` and immutable Codex review `D:/Projects/chb-ban-hang/docs/reviews/2026-10-16-COM002-round1-review.md`. No other worker owns the added COM-002 files. This is fix round 1 of at most five.

Run `npm run task:start -- COM-002 claude "Review round 1: typed RPC and immutable snapshot insert boundary"` before editing. Preserve the previous report, summary and all worktree changes. Fix only the following:

1. Reproduce the report's TS2345 at `src/services/orders.service.ts:204`. Make the new RPC service call typecheck and build with a narrow, explicit temporary type bridge if necessary while Docker is unavailable. Do not hand-edit `database.generated.ts`; generation remains required after DB health recovers. Keep the runtime error handling of `call(...)` intact. Run the non-DB checks needed to prove the fix.
2. The new migration currently permits direct `service_role` INSERT into `order_item_commission_snapshots`. That can prefill a draft's item and make the first-confirmation `ON CONFLICT DO NOTHING` retain forged values. Revoke direct INSERT for service_role while retaining trigger-owned insertion, and add a regression in the COM-002 integration test or pgTAP test: direct service-role INSERT is refused, and normal first confirmation still writes its real snapshot. Do not weaken RLS or alter earlier applied migrations.

Keep the existing snapshot moment (`CONFIRMED`) and the open discount policy as documented; do not invent business rules. Review the complete diff and tests for a P0/P1 regression. No direct DB reset, pgTAP or integration run while the Docker Linux engine pipe is absent. No commit, push, PR, merge or deployment.

Fill a new sanitized summary at `tmp/COM-002-round2-summary.json` with current acceptance evidence and exact validation limits. The coordinator will run `task:finish` for this attempt with the existing DB blocker flag and shared lock path after your terminal result, because the frozen worker allowlist rejected the prior prefixed command. Do not retry denied Bash commands in alternate spellings or change the allowlist. End with a concise account of edits and checks actually run.
