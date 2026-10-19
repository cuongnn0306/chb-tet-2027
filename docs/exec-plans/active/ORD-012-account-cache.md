# ORD-012 — Account-scoped detail and history

E03 detail/history service exists. Active access outer guard; account/role/order keyed child resets action dialog and notice. Detail/history query keys append identity scope to established prefixes, preserving mutation invalidation. No changes to state rules, services, money or child delivery/payment/stock contracts. Child panel caches require separate acceptance; this change does not claim to isolate every nested query. RLS authoritative; submitted mutations can finish. Browser/mobile/staging pending. Not Done.

Follow-up: nested stock, payment instructions/history and delivery list caches append current account/role scope and are disabled without active access. Existing prefix invalidations remain. Parent keyed remount clears nested dialogs on identity change. UI-only change; no service/RPC/schema policy modified. Previous report immutable; new pipeline required.
