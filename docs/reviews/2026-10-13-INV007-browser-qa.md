# INV-007 — controlled browser QA, 13/10/2026

## Scope and method

Continued reviewed checkpoint `70339cb` in an isolated worktree. Vite served the actual InventorySummaryPage with a controlled AuthContext, one persistent QueryClient and explicitly seeded user/role-scoped catalog and summary keys. Old unscoped keys contained a DECOY marker. The fixture blocked all unexpected fetch requests and used synthetic data only; it did not connect to Supabase, log in, validate RLS or mutate stock.

## Observed evidence

- Warehouse A selected location B: sellable 112. Switching the same ID to Sales reset the selection to its location A default, showed A-sale/333 and only two table headers. Warehouse counters disappeared.
- After clearing Sales A's selection, switching to Sales B selected B's location B default and displayed B-only/223. Neither A's rows nor the unscoped DECOY appeared. Repeated after the source correction.
- Loading showed Đang tải. Inactive, no_profile and signed_out showed the existing no-permission message. The explicit fixture diagnostic button showed zero mounted query observers and zero attempted fetches in each state.
- At 320 × 780, a deliberately long location label remained within the page. Warehouse document scrollWidth was 305; Sales B scrollWidth was 320 with innerWidth 320. The detailed table scrolled inside its container.
- Empty catalog originally rendered headers without rows or guidance. Fresh task:start preceded a scoped correction using shared EmptyState. Retest showed “Chưa có sản phẩm để hiển thị tồn kho” and Admin guidance, without an empty table. See `evidence/INV007-empty-320.png` and `evidence/INV007-account-320.png`.
- Independent read-only review found no actionable issue: success gating and early catalog error/loading handling remain correct; account/role mounting, keys and inventory calculations are unchanged.

## Limits and remaining gates

This is component/context/cache/mobile evidence, not real authenticated or provider acceptance. Error handling was statically reviewed; network error/retry was not exercised by this fixture. Real AuthProvider/GoTrue, RPC/RLS, local DB reset/pgTAP/integration, remote CI, CHB staging and Owner acceptance remain pending. Today's read-only engine readiness check found the Docker Linux-engine pipe absent; no DB command or Docker startup was attempted. Preserve the previous report unchanged and use the fresh task:finish report for the new source. Status remains needs_validation, not Done.
