# E06: Payment & SePay

Source: IMPLEMENTATION_INFRA_PLAN §E06, §11, TECH_DESIGN §3.21, §10, PRD §18, B11.6, B19.
Branch: `feature/PAY-001-payments` (stacked on `feature/RES-001-reservations`).

| Task                                           | Status                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| PAY-001 payment schema                         | done (`payments`, `payment_events`)                                                                                                     |
| PAY-002 manual payment (cash / transfer / COD) | done (Admin; COD can be recorded as expected = PENDING then confirmed)                                                                  |
| PAY-003 deposit policy engine                  | done: settings-driven, rounded up, auto-confirms the order when covered                                                                 |
| PAY-004 payment code per order                 | done: the payment code is the order code (`TET000123`); each payment also gets a receipt number `PAY000123`                             |
| PAY-005 VietQR display                         | done: QR image from the SePay QR service + bank details + exact amount + code + copy buttons                                            |
| PAY-006 SePay Test Mode setup                  | **human action**: see `docs/runbooks/SEPAY_SETUP.md`                                                                                    |
| PAY-007 webhook endpoint                       | done: Edge Function `sepay-webhook` (auth, parse) + DB `process_sepay_webhook` (all rules). Smoke-tested end to end locally             |
| PAY-008 payment deduplication                  | done: two layers (`payment_events` unique (provider, event id) + `payments` unique (provider, reference)); concurrent duplicates tested |
| PAY-009 realtime order payment update          | done: Supabase Realtime on `payments`/`orders`, verified live in the browser                                                            |
| PAY-010 refund / void payment                  | done (Admin, reason required, audited); a refund frees the order to be cancelled                                                        |

## Invariants proven by tests

- `orders.paid_amount` = sum of CONFIRMED payments; neither it nor `deposit_required` can be edited by anyone (guard flag, also against the service role).
- A payment can never push an order beyond its net amount (checked under a row lock; concurrent test: two 300k payments on a 500k order give one winner).
- A retried or concurrently duplicated webhook credits exactly once (6 concurrent identical deliveries give 1 `CREDITED` and 5 `DUPLICATE`).
- Money that cannot be credited safely is never silently added: unknown code gives `UNMATCHED`; overpayment or an order that cannot take money gives `NEEDS_REVIEW` as a PENDING payment; outgoing money or bad amounts give `IGNORED`.
- Payments are never deleted; amount, order, method and provider identity are immutable; closed payments cannot change state.
- Webhook authentication fails closed (no secret configured means every request is rejected); the webhook DB function is callable by the service role only.

## Decisions (docs silent; flag if wrong)

- Deposit is fixed when the Admin confirms the order into WAITING_DEPOSIT: PERCENT rounds UP to whole VND (never below policy), FIXED_AMOUNT is taken as is, both capped at the net amount. If the policy settings are missing, confirming fails with a clear message (no hidden default). Deposit 0 confirms the order immediately.
- Payments received before the Admin confirmed the order count toward the deposit.
- A payment can only be recorded as received if it fits the remaining balance; partial payments are allowed.
- SEC-007 (supersedes the earlier HMAC assumption): HMAC follows SePay's official contract: `X-SePay-Timestamp` (Unix s) + `X-SePay-Signature: sha256=<hex>` over `{timestamp}.{raw body}`, 5-minute window both directions. API key and HMAC are alternative modes: a request carrying a signature must pass HMAC (an API key never rescues a bad or stale signature); otherwise the API key decides. Verified against the official docs on 2026-10-02 and in the Edge runtime locally. Not verified: SePay's real signed webhook (needs Test Mode).
- PAY-007 / RV-02 (migration `20261002040000_sepay_payload_validation.sql`): the processor never auto-credits unless the payload proves it is incoming money on the configured account. `transferType` must be `in`/`out` (case-insensitive; missing or unknown is NOT assumed `in`): `out` gives `IGNORED`, anything else `NEEDS_REVIEW`. `accountNumber` and `gateway` must match `app_settings.sepay_config` (`account_no`, and `gateway` or else `bank`; account number compared exactly and bank name by an alias rule: the first version stripped punctuation, which the correction note below replaced); missing fields, a mismatch or no configured account give `NEEDS_REVIEW` with a reason, and **no payment is created**. `id` must be an integer (number or digit string) else the call is rejected (400, nothing to log under). Amounts must be a positive integer number (missing amount used to slip through as NULL: fixed). Decision to confirm: `NEEDS_REVIEW` (visible, Admin dismisses with a note) rather than `IGNORED` for uncertain events, because a retry of an IGNORED event only returns DUPLICATE. Only one receiving account is supported (the docs define none for several). Admin cannot assign such an event to an order (only `UNMATCHED` events can be assigned).
- PAY-007 correction (migration `20261002050000_sepay_account_and_id_canonical.sql`, after review): (1) `accountNumber` is an identifier: it must be a JSON string of 3-30 ASCII letters/digits, compared exactly (case-insensitive only), leading zeros significant, nothing stripped or trimmed; other types or formats are NEEDS_REVIEW with no payment; the configured `account_no` must meet the same format or the account counts as not configured. Bank names use their own documented alias rule (case, spaces, dots, hyphens, underscores). (2) The transaction id is canonicalised (digits only, leading zeros removed, 1-18 digits, >= 1) to ONE key before both dedup layers, the raw payload is kept; rows stored earlier under a non-canonical key are not rewritten (payment identity is immutable) but are found through an index on the canonical value, so they still answer DUPLICATE. The Edge Function additionally refuses a numeric id beyond 2^53 (JSON.parse would already have rounded it). Decision to confirm: digit-string ids stay supported.
- SePay payload fields assumed: `id`, `transferType`, `transferAmount`, `code`, `content`/`description`, `transactionDate` (Vietnam time), `gateway`. The real payload and the signing header must be verified in SePay Test Mode (runbook step 3.4 and 3.6).
- The QR image is fetched from the public SePay QR service (`qr.sepay.vn`), which therefore sees account, amount and payment code. No secrets are placed in the URL.
- Refund is bookkeeping only (REFUNDED + reason). The system never moves money.
- Order status history now uses `clock_timestamp()` so same-transaction transitions (deposit paid, then auto-confirmed) keep their order.

## Validation log

- lint, typecheck, unit (149), build pass. Integration: 215 tests (27 for payments), stable on two runs; pgTAP 111.
- Edge Function smoke test against the local stack: 401 without or with a wrong key, 405 for GET, 400 for invalid JSON or a missing id, 200 `UNMATCHED`, a repeated delivery returns `DUPLICATE`.
- Browser (Admin): QR with the exact deposit and code; a webhook delivered while the page was open updated the order to "Đã xác nhận", paid 150.000 ₫, and the QR switched to the remaining amount, without reloading; the review queue lists unmatched/needs-review transfers and pending payments.
- Not manually checked: the record-payment and refund dialogs in the browser (covered by integration tests), phone layout, SePay's real payload (needs their Test Mode).
