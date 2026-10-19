# CUS-002 — Account-scoped customer create/edit form

Existing canonical create/edit service, validation and RLS stay authoritative. Form waits for active access and remounts by account/role/customer identity, resetting draft, errors and duplicate dismissal when context changes. Customer permissions remain RLS-defined; no new role rule. Existing in-flight request can finish; this does not revoke a submitted transaction. No schema/service/config changes. Browser/mobile/staging pending. Not Done.
