# INF-006 — Local seed samples

Canonical source: implementation plan E00 `INF-006`. Scope is the local demo seed only; no schema, service contract, client route or production data changes.

## Dependency and ownership

- Base `60cdcd6` includes E01 roles/customers/orders and E04/E05 batch inventory primitives. The existing seed already has 11 SKUs, five locations, seven customers, and opening-stock batches/movements.
- Claude owns separate INF-008/TRF-001 scopes; this Codex worktree changes only `supabase/seed.sql`, its pgTAP assertion file and this plan.
- E14 UAT-001's complete cross-module dataset remains pending until transfer, production and return foundations are accepted.

## Work

1. Create two fake multi-SKU draft orders through `save_draft_order`, attributed to the seeded sale/store profiles.
2. Keep the orders as drafts so the seed creates no confirmed demand, hold, payment or commission entry.
3. Assert fixture counts, totals, line snapshots and ledger reconciliation with pgTAP.
4. Run the normal task:finish validation under the shared DB lease; review report and source freshness. External staging/mobile/Owner acceptance remains separate.

## 13/10 reviewed checkpoint

Source and checked parent match the immutable report above. The owner authorized feature-branch checkpoints in the orchestration request; earlier preserve-without-commit guidance is superseded for this reviewed checkpoint. Commit unchanged source, existing reports and registry together on `codex/inf-006-reviewed-checkpoint`. No source edit or new validation run. Preserve report status needs_validation and all remaining external/DB gates; this is not Done or merge authorization.
