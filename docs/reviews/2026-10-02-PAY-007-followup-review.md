# PAY-007 — Codex follow-up review, 2026-10-02

Reviewed the current uncommitted implementation and latest report:
`docs/handoff/reports/PAY-007-2026-10-02T05-13-01-317Z.md`.
This review supersedes the local blocking conclusion in
`docs/reviews/2026-10-02-PAY-007-review.md` for the two findings below.
Previous reports and reviews remain unchanged.

## Result

Both prior local findings are resolved in the reviewed implementation. No new
blocking issue was identified in this scoped review. DEL-012 can proceed while
PAY-007 remains `needs_validation` for real-provider/staging acceptance and any
remaining Definition of Done requirements. This is a code review, not release
approval or confirmation of production behavior.

## Finding resolution

- Account identifier: the processor validates the string separately from gateway normalization, preserves leading zeros, and does not delete punctuation or coerce numbers into matching identifiers. The prior synthetic string `12345.67890` and number `-1234567890`, with configured account `1234567890`, now both return `NEEDS_REVIEW`.
- Deduplication: numeric and supported digit-string representations use one canonical key before event insertion and payment references. Replaying synthetic ID `987654321076514` as `0987654321076514` now returns `DUPLICATE`; only one event is stored. The new migration also looks up legacy leading-zero event keys without rewriting identities.
- Edge adapter: numeric IDs outside `Number.isSafeInteger` are rejected before RPC invocation; this includes `2^53` itself. Larger supported digit strings retain their exact value. Authentication still precedes payload handling.

## Independent validation

- `npm run test:integration -- tests/integration/payments.test.ts`: 54 tests passed.
- `npm test -- tests/unit/functions/sepay-payload.test.ts tests/unit/functions/webhook-auth.test.ts`: 19 tests passed across two files.
- `npm run task:verify`: seven report pairs structurally valid. This command alone did not validate PR evidence or source freshness.
- Independent comparison using the pipeline's CRLF-normalized SHA-256 rules: all 213 current governed source files match the latest report snapshot; no added, removed, or changed source mismatch; aggregate digest matches.
- `git diff --check`: passed, with line-ending warnings only.
- Both previous SQL reproductions reran in the local `supabase_db_chb-ban-hang` using synthetic configuration/payloads within `BEGIN` / `ROLLBACK`; no reproduction data or configuration change was retained.
- Other required repository checks were recorded as passed in Claude's latest report, but were not rerun in this scoped review.
- No real SePay webhook, staging validation, or remote PR CI was performed.

## Remaining assumptions

The 3-30 ASCII alphanumeric account format, case-insensitive alphanumeric account
comparison, gateway formatting aliases, and supported string ID representation
are implementation choices documented in the runbook. The provider's string type
alone does not establish the account length/alphabet/case rules. Verify them
against the actual receiving account and Test Mode payload before enabling Live;
preserve fail-closed behavior and require an explicit rule for any extension.

Review adds only this document. Implementation, task registry, and historical
reports were not changed, and no commit or push was performed.

## Next task

DEL-012 / RV-03: retain the stock footprint of failed deliveries while goods
remain in logistics. Cover the split-source X/Y reproduction, failed delivery,
rescheduling and redispatch without implicitly freeing or double-consuming stock.
Keep the work separate from DEL-011 batch/pick binding and DEL-005 allocation UI.
