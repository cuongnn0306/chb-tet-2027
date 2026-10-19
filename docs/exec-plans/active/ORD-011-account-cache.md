# ORD-011 — Account-scoped order list

Existing E03 list and RLS service. Active-access outer guard; child keyed by account/role resets filters, page and query observer. Cache includes account/role; prior-page placeholder stays within the same keyed observer, so pagination behavior remains. No schema/service/state/money changes. Browser account-switch and mobile/staging pending; not Done.

First attempt failed lint/typecheck/build: CRLF-sensitive replacement missed the wrapper while inserting scope in query key. Corrected with normalized input and an explicit expected-block assertion; historical failed report preserved. New pipeline required.
