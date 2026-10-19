# INV-008 batch cache isolation

E01/E04 services and existing Admin/Warehouse/Production role vocabulary ready. Outer page validates access before mounting query-bearing content. Content is keyed by account ID/role, resetting filters, notices, reconciliation results and open dialogs when scope changes. Catalog/balance query keys include scope. Original route guard and write capability remain; no service/schema/RLS/auth configuration changes. An already-running mutation cannot be cancelled by unmount: DB permission remains authoritative, no claim of global auth race elimination.

Preserve prior task source/reports; current combined source validated through own taskfinish. DB not_run protects root schema. Browser/mobile/staging and actual role-switch acceptance pending.
