# INV-009 ledger cache isolation

Existing E01/E04 ledger and Admin/Warehouse roles ready. Ledger list and product keys now include active account/role. Denied and inactive access disable requests and render shared no-permission state; loading access renders loading. Removed previous-data placeholder to avoid prior account rows during query changes. Hooks remain unconditional. No schema/RLS/service/auth configuration changes, no ledger mutation. Existing route role guard retained.

Prior CUS006/INV007 source preserved; their whole-tree reports are historical after this edit. Taskfinish validates combined current source. DB not_run preserves shared root schema; browser/mobile/staging pending. No mirrored key tests; complete existing tests run through pipeline.
