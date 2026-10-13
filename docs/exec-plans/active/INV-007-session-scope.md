# INV-007 — inventory summary session scope

## Context and dependency

The committed `60cdcd6` baseline already has the E01/E04 inventory schema, summary RPC and page. The earlier Codex INV-007 report is `needs_validation`; its single source file still matches that report. Its account-scoped query keys disabled reads without an active account, but the page displayed an indefinite loading state in that case and retained the previous account's location filter when the active user changed.

## Scope

- Keep summary and catalog cache keys scoped to the active user ID and role.
- Mount query-bearing content only for active access, with loading and no-permission states for other access states.
- Remount the content when user ID or role changes so the location filter starts from that user's default.
- Preserve existing read-only summary calculations, role detail visibility, services, schema and RLS.

## Validation and acceptance

Run the standard task pipeline and review the source diff and report fingerprint. Verify account/role switching and narrow mobile viewport in an authenticated browser before release. Docker's Linux engine is unavailable at this attempt start, so DB reset, pgTAP and integration must be recorded `not_run` through `task:finish` using `CHB_DB_VALIDATION_BLOCKER`; no direct DB command or retry. Staging and Owner acceptance remain pending, so this attempt is not Done.

## 13/10 reviewed checkpoint

Source and checked parent match the immutable report above. The owner authorized feature-branch checkpoints in the orchestration request; earlier preserve-without-commit guidance is superseded for this reviewed checkpoint. Commit unchanged source, existing reports and registry together on `codex/inv-007-reviewed-checkpoint`. No source edit or new validation run. Preserve report status needs_validation and all remaining external/DB gates; this is not Done or merge authorization.

## 13/10 browser follow-up

Checkpoint `70339cb` remains preserved. A local controlled AuthContext fixture rendered the actual page with one persistent QueryClient and account/role-scoped cached rows; unexpected network calls were blocked. Account and role changes reset the location and show only the corresponding cached data; inactive/loading/signed-out states are checked separately. This fixture does not verify real login, RPC or RLS.

At 320px the long location label did not overflow the document. An empty product catalog showed only table headers, contrary to the required empty state. A fresh INV-007 attempt on `codex/inv-007-empty-state` adds the existing shared EmptyState and omits the empty table. No inventory calculation, schema, service, permission or query-key change. Recheck the actual page and run task:finish; record DB reset/pgTAP/integration as not_run because the Linux engine pipe was absent on today's read-only readiness check. CI, real authenticated browser, staging and Owner acceptance remain pending.

### Follow-up result

Report `docs/handoff/reports/INV-007-2026-10-13T03-39-01-473Z.json`: pipeline, lint, typecheck, tests, build, format and env pass. DB reset, pgTAP and integration are not_run; status needs_validation. Source hash matches the report. Controlled browser retest and independent static review found no further actionable issue; evidence and limitations are in `docs/reviews/2026-10-13-INV007-browser-qa.md`. Temporary browser tab and Vite server were closed, viewport override reset, and port 4176 has no listener. No schema changes, remote writes, merges or deployment. Keep this plan active until remaining acceptance gates are satisfied.
