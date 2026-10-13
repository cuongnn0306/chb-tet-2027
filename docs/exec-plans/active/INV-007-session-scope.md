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
