# SEC-008 independent fallback review

Report: C:/Users/HP/.codex/worktrees/codex-sec-008/chb-ban-hang/docs/handoff/reports/SEC-008-2026-10-03T10-17-43-238Z.json
Root independently checked source fingerprint: zero mismatches. Read scoped test: immutable replay with changed amount/order/content; eight competing requests have one winner; overflow after event insertion rolls back and retry credits once. Sorted order snapshots and initial RPC error assertion improve determinism/diagnosis. No migration/application behavior change. Baseline excludes root PAY-007 canonicalization fixes; no claim to cover them.
Lint/typecheck/unit/build/env exit 0. Pipeline fixture pass4/fail8 due sandbox .git/config restrictions. Format inherited baseline 175 files; scoped new files formatted. DB reset/pgTAP/integration not_run, staging not verified. New integration tests have not executed. First failed report retained.
No P1 code finding in scoped static review. Keep needs_validation; baseline-check integration and fresh combined pipeline required. Do not copy lane source into root automatically. Docker and fixture sandbox access require authorized execution environment; no permissions bypass.
