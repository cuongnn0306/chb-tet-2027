# INV-006 — Native Excel import validation on a clean stack

Canonical task: implementation plan E04 `INV-006`. The existing Admin opening-stock import supports paste/CSV, dry-run and atomic ledger posting. PRD §21 asks for the six-column Excel import (Kho, SKU, Batch, NSX, HSD, SL).

## Dependency and ownership

- Base `60cdcd6` contains the E04 import RPC, typed text parser and relevant tests. The source Codex worktree has two append-only INV-006 reports; its five XLSX-related files match the latest report's normalized source hashes.
- This new clean worktree copies those exact files only. The source worktree retains its other dirty tasks. Claude INF-008/TRF-001 files, schema and service contracts are untouched.
- Two earlier INV-006 attempts could not run DB checks when Docker was unavailable and failed repository-wide format. Docker is now healthy, so this is a changed validation condition, not a repeated unchanged blocker.

## Acceptance and checks

1. Accept a one-sheet `.xlsx` up to 5 MB and at most 5,000 data rows; preserve original row numbers and dates, then pass rows through the established six-column validator.
2. Keep the dry-run then atomic apply path, Admin-only page, and account-scoped preview state.
3. Run the full task:finish pipeline under the shared DB lease, inspect fresh report, source hashes and changed-file scope.
4. Keep staging, mobile and Owner review pending until separately verified.

## 13/10 reviewed checkpoint

Source and checked parent match the immutable report above. The owner authorized feature-branch checkpoints in the orchestration request; earlier preserve-without-commit guidance is superseded for this reviewed checkpoint. Commit unchanged source, existing reports and registry together on `codex/inv-006-reviewed-checkpoint`. No source edit or new validation run. Preserve report status needs_validation and all remaining external/DB gates; this is not Done or merge authorization.
