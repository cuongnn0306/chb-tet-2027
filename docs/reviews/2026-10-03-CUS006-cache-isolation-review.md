# CUS-006 customer cache isolation review

Report: C:/Users/HP/.codex/worktrees/codex-cus-006/chb-ban-hang/docs/handoff/reports/CUS-006-2026-10-03T19-57-08-027Z.json

Source fingerprint: all recorded files match after CRLF normalization. Pipeline, lint, typecheck, unit tests, build and environment checks passed. Three focused QueryClient/QueryObserver regressions passed. Format check failed on 167 baseline files; no blanket formatting or retry against unchanged blocker. DB reset, pgTAP and integration not run to preserve the shared root schema while this isolated baseline differs.

Customer list, picker, history and duplicate suggestion query keys now include active account ID and role; customer list no longer carries previous query rows through placeholder data. This covers these four customer query families only. Browser account-switch, mobile, real RLS and staging acceptance remain pending. No schema/service contracts changed; no integration into root or Done claim.

Next: preserve the isolated source and immutable report; review integration against current root baseline before fresh pipeline validation. Claude INF-008 reservation remains untouched; no quota retry before 2026-10-03T23:21:00Z.
