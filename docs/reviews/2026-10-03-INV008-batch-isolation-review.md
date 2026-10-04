# INV-008 review

Report: C:/Users/HP/.codex/worktrees/codex-cus-006/chb-ban-hang/docs/handoff/reports/INV-008-2026-10-03T20-56-37-289Z.json

All source fingerprints match. Pipeline/lint/typecheck/tests/build/env pass. Baseline formatting fails; DB reset/pgTAP/integration not_run protects current root schema. No Done claim.

Outer active-role guard mounts keyed content only for existing Admin/Warehouse/Production. Account/role change resets local dialogs, filters and reconciliation/notice state; catalog/balance keys contain identity/role. Prefix query invalidation remains compatible. Existing write capability and service/RLS/schema unchanged. In-flight mutations may complete after unmount; real browser/mobile/RLS/staging validation pending. Whole-tree earlier reports remain historical; current INV008 report covers combined non-DB checks.

Next: investigate canonical INV006 native xlsx gap independently. Requires approved existing import row contract and parser dependency review; do not add schema/service contract or touch Claude pipeline scopes. No quota probe before23:21Z.
