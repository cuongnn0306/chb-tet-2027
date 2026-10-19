# SEC-002 — Payment-event review audit with catalog guard

## Task, dependency and provenance

Implementation plan SEC-002, PRD Audit/Payments, TECH_DESIGN 3.27 and AGENTS 7 require
traceable Admin payment decisions. Existing E06 event review RPCs and immutable audit_logs
are committed prerequisites. Parent e0464a7 adds the corrected SEC-003 catalog guard to
the reviewed delivery/allocation/tooling foundation; develop does not yet contain it.

During the user-return gap, the controller recorded a closed SEC-002 heartbeat attempt
on bef4f19, report SEC-002-2026-10-12T14-39-37-256Z: all local checks, including 344
integration tests, passed. That source excludes SEC-003. Preserve that worktree/report.
This new attempt validates the combined SEC-002 + SEC-003 source, not a concurrent worker.
Initial ownership guard detected the controller change before any source copy. Re-read
the actual closed history and reserve the new isolated scope; no live dispatch exists.

Only two source files copied from the closed sec-002-audit-stack lane after LF SHA-256
verification against the immutable original SEC-002 report, with both target paths absent:

- `supabase/migrations/20261005165000_payment_event_review_audit.sql`:
  e3289bab562b601056403c45409be0dab6b86986466b0e6e08f34dd5cb7fa0c1.
- `tests/integration/payment-event-audit.test.ts`:
  6112f37f2ea3f4948bb6c3d7b46bf32f1ef467e8cbb90094506ea36769b294bc.

## Scope, acceptance and review

Add a transition-only AFTER UPDATE trigger for resolved_at null to non-null. One immutable
audit row records actor/event/action/before/after/reason in the payment decision transaction.
Only eight explicit decision fields are copied, excluding raw webhook payload. Existing
Admin RPC bodies, payment credit/idempotency/row locks, webhook outcomes and RLS stay intact.
Private helper execute is revoked from client roles and definer search_path is empty.
No public schema/type contract change: generated public types need no regeneration.

Eleven integration tests cover successful/failed/repeated/concurrent decisions, before/after
fields, payload exclusion, one credit, audit/event immutability, role boundaries and webhook
outcomes without review audit. Independent read-only review found no actionable source issue.
Limits: mixed assign-vs-dismiss concurrency and injected audit-insert failure are not separately
tested; rollback is structural through the transaction. Admin free-text notes are retained.

## Validation and external gates

Run fresh task:finish under the shared local DB lease, including current catalog guard and
all app/reset/pgTAP/integration checks. Record actual outcome below. No manual or remote DB
commands. Owner confirms separate CHB staging is unconfigured and Claude/Vercel access is
not restored; continue independent local work. CI, staging and Owner acceptance are pending.
No Done or merge certification from local checks.

Fresh report SEC-002-2026-10-12T16-16-13-964Z: all 12 local check rows pass, including local reset, 318 pgTAP assertions and 344 integration tests. Shared lease released. needs_validation remains for external acceptance.
