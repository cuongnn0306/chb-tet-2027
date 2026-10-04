# DEL-010 integration readiness — 2026-10-04

The root and fallback worktrees share HEAD `9548886547e79a5eb21898e287f1303f4bd2fbe9`, but their dirty `DeliveryBoardPage.tsx` files differ. Baseline hashes and their read-only comparison are saved in `tmp/DEL010-integration-review/manifest.json` and `board-root-vs-fallback.diff`. No source was copied into the root workspace.

The root board adds allocation controls, a logistics warning and the third `goods_in_logistics` argument to `availableDeliveryActions`. The fallback board carries the earlier DEL-007 account/role query isolation and the new DEL-010 month grid. Copying either whole file over the other would remove functionality or break the domain call. Integration must add the account-scoped wrapper and calendar state/query/rendering to the current root board while retaining its allocation button/dialog, logistics badge and three-argument action rule. The new calendar helper, component and unit test are independent additions but still require a fresh combined-source task:start/finish and acceptance checks.

Root TRF-001 remains Claude-owned and usage-limited until at least 2026-10-04T12:21:00Z; this review does not release its session or scopes. DEL-010 remains `needs_validation`. Browser/mobile/staging acceptance and DB validation in a source-consistent workspace remain outstanding.
