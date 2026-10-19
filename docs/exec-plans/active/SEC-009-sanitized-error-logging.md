# SEC-009: Sanitized error logging for the SePay webhook

Source: IMPLEMENTATION_INFRA_PLAN §E13 (SEC-009 "Error logging", no further acceptance text), AGENTS §7,
`docs/reviews/2026-10-02-project-review.md` (RV-13 raised log volume; no dedicated RV item for log content),
PROJECT_PROGRESS row SEC-009 ("DB error mapping/Edge error codes có; centralized errors/correlation/alert chưa đầy đủ").
Dependencies preserved: SEC-006 (limits), SEC-007 (authentication), PAY-007 (payment processing).

## Scope

In: `supabase/functions/sepay-webhook/index.ts`, new `supabase/functions/_shared/safe-log.ts`,
`tests/unit/functions/safe-log.test.ts`, `docs/runbooks/SEPAY_SETUP.md`, this plan.
Out: migrations, generated types, payment/auth/limit logic, package/CI/coordinator files, any monitoring or
alerting infrastructure, any credential. The only sensitive webhook path in the repository is `sepay-webhook`.

## Finding

Existing logging was already free of payloads and headers, but it relied on each call site remembering that
(`console.warn` with an interpolated reason string) and left gaps:

- `auth.reason` and `logReason` were interpolated as strings with no guarantee they stay a closed set.
- Payload rejections (`invalid_json`, `invalid_payload`, `invalid_id`) were not logged at all.
- An exception thrown inside the handler (crypto, `createClient`, a network failure in `rpc`) was unhandled, so
  the runtime logged it itself, including the exception message, which can quote request or database content
  (a JSON `SyntaxError` quotes part of the body, a PostgREST error quotes column values).
- No per-request correlation id, so lines could not be joined.

## Decisions

- **Allowlist by construction, not scrubbing.** A line is built only from values `safe-log.ts` controls: `event`,
  `reason` and `level` from closed lists; `sql_state` only if it matches the five-character SQLSTATE shape;
  `error_name` only from a list of standard JS error classes; `cid` only if it is a generated 32-hex id. Anything
  else becomes `unknown` / `invalid`. Free text from a request or exception cannot enter, so there is nothing to
  redact and no regex of "sensitive patterns" to get wrong.
- **Never read exception text.** Only the class name is used. Database errors contribute only `error.code`.
- **Stable reasons.** `WEBHOOK_LOG_REASONS` includes every reason `request-limits.ts` and `webhook-auth.ts` can
  produce; a drift-guard test fails if a new reason is added there without being added here.
- **Correlation id** is `crypto.getRandomValues`, per request, unrelated to request content or client address.
- **Behavior preserved.** Status codes and bodies are unchanged. Two deliberate differences: (1) the new
  `invalid_json` / `invalid_payload` / `invalid_id` / `rpc_*` lines; (2) an unexpected exception is now caught and
  answered 500 `{"error":"internal_error"}` (previously an unhandled throw, also a 500 from the runtime) so it is
  logged by class name only. Rate-limit log throttling (first rejection per window) is unchanged.
- A throwing log sink is swallowed so logging can never change a response.
- Log level mapping: client-caused rejections are `warn`; processing failures and exceptions are `error`.
- Line format is JSON (was free text `sepay-webhook: ...`). Anything that grepped the old text must use the new keys;
  none exists in the repository.

## Limitations (explicit, do not claim more)

- Not run in the Edge runtime (`supabase functions serve` needs Docker, which is blocked in this workspace) and not
  verified on staging: how the platform renders these lines in Logs is unverified.
- The unit test for `index.ts` is a source scan (the entry point calls `Deno.serve` and cannot be imported under
  Vitest). It guards against logging raw values or reading exception text, but it does not execute the handler.
  Behavior of `index.ts` end to end is therefore not exercised by an automated test in this task.
- Redaction tests use synthetic values only. They show the helper cannot emit the injected values; they do not
  prove the platform never logs something else on its own (for example runtime-level request logs).
- No monitoring, alerting, retention or dashboards were created. Needs an Owner/DevOps decision.
- Other Edge Functions: none exist besides `sepay-webhook`; the helper is generic enough to reuse.

## Tests

`tests/unit/functions/safe-log.test.ts` (new): reason allowlist and drift guard against the real gate and
authentication reasons; SQLSTATE shape; error class name only (message never read, forged names rejected, real
`JSON.parse` SyntaxError not quoted); correlation id shape, per-request stability, rejection of foreign ids; line
shape and key set; level routing; throwing sink; redaction regression pushing synthetic keys, signatures, account
number, names, phone, content, IP and DB error text through every field and through a real failed
`authenticateWebhook`; source scan of `index.ts` (console only via sinks, no `.message/.stack/.details/.hint`, no raw
payload/header identifiers in log calls).

## Validation

Local checks run by the agent: `npm test -- tests/unit/functions`, `npm run lint`, `npm run typecheck`,
`npm run format:check` (all pass). Full pipeline via `npm run task:finish`; DB reset, pgTAP and integration are
expected `not_run` (inherited CHB_DB_VALIDATION_BLOCKER, Docker unavailable). No DB change in this task.

## Acceptance (evidence)

- No payloads/PII/secrets/auth headers/unsafe exception values in logs: enforced by construction, covered by the
  redaction regression tests (synthetic data).
- Useful stable reason/correlation categories: `event` + `reason` + `cid` (+ `sql_state`, `error_name`).
- Authentication, body limits and payment behavior preserved: no change to `webhook-auth.ts`, `request-limits.ts`,
  `sepay-payload.ts` or the RPC call; existing function tests pass unchanged.
- Not verified: Edge runtime smoke, staging log rendering, any alerting.
