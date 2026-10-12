# RPT-001 KPI definitions

Docs-only canonical task, independent of Claude delivery and return code. Read PRD22/B21/B22, TECH13/3.8/10, implementation E12 and the Owner's decisions of 11/10/2026. Integrate the earlier glossary into a clean worktree and record approved event dates, cancellation reversal and attribution without schema/service/query changes. Deliverable: `docs/runbooks/KPI_DEFINITIONS.md`. No migration, cloud or ledger mutation.

Acceptance: formulas and dates traced to approved spec; distinguish listed-price sales, net sales, cancellation reversal, return adjustment, collected payments and delivery KPI. Preserve transfer/ledger invariants. Total-order count, inventory snapshot period and Days of Stock demand window remain unresolved; report queries must not infer them. Manual doc review only; no implementation-mirroring test needed. `task:finish` required; Docker Linux engine is unavailable. RPT-002+ queries and staging review remain separate.

## Attempt 12/10/2026

The original glossary/report in `codex-sec-008` was reviewed read-only. This attempt copies only the glossary and plan into a clean worktree at committed `2df547e`, then updates them to reflect the three KPI decisions approved by the Owner on 11/10/2026. The current primary checkout has uncommitted specification updates, so no primary files are overwritten. A new immutable task report records exact validation outcomes. This documentation does not certify report queries or a dashboard.
