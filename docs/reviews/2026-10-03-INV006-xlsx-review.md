# INV-006 native xlsx review

Report: C:/Users/HP/.codex/worktrees/codex-cus-006/chb-ban-hang/docs/handoff/reports/INV-006-2026-10-03T21-57-11-632Z.json

Source fresh after CRLF normalization. Pipeline/lint/typecheck/tests/build/env pass; three focused real ZIP workbook/conversion tests pass. Format fails on171 files including baseline/plan formatting; no pass claim. DB reset/pgTAP/integration not_run preserves current root schema.

Pinned read-excel-file9.3.10 reads one-sheet xlsx in browser, columns serialized with quotes/UTC dates into unchanged validator/dry-run/atomic import. Blank rows preserved in converter; Vietnamese Kho header normalized. No service/schema/RLS change. Pending file reads use sequence; file selection clears previous checked/apply state; check/apply disable file/text edits. CSV and paste retained.

Limitations: library may trim leading/trailing empty sheet rows before conversion (actual worksheet row reporting requires browser fixture review); 5MB compressed limit does not bound decompressed XML memory; library reads cached formula values without execution; only standard date formats covered and no real Excel-date formatted workbook fixture yet. Multi-sheet files require user to prepare one sheet. Mobile/browser/real DB/staging acceptance pending, not Done. Prior whole-tree reports historical after new source.

Next review: independent canonical task selection; preserve source/report and no retry of unchanged format/DB blocker. Claude INF008 exact session remains reserved until23:21Z.
