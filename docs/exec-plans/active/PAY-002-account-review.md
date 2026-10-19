# PAY-002 — Account-scoped Admin payment review

Existing manual review/payment service and RLS remain authoritative. The Admin-only queue waits for active access, remounts by account/role to clear dialogs/notices, and separates event/pending caches by identity. Existing invalidation prefixes remain. No amount calculation, webhook, RPC, database or payment status logic changed. Real account-switch/manual payment browser, mobile and staging pending. Not Done.
