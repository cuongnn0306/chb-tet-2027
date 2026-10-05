# SEC-006: Rate / body limits for the SePay webhook

Source: IMPLEMENTATION_INFRA_PLAN §E13 (SEC-006 "Rate-limit sensitive endpoint", no further acceptance text), review RV-13
(`docs/reviews/2026-10-02-project-review.md`), AGENTS §7. Dependencies: PAY-007 / SEC-007 behaviour must be preserved.

## Scope

In: `supabase/functions/sepay-webhook/index.ts`, new `supabase/functions/_shared/request-limits.ts`,
`tests/unit/functions/request-limits.test.ts`, `docs/runbooks/SEPAY_SETUP.md`, this plan.
Out: delivery SQL/types, security scanner, package/CI/coordinator, any cloud infrastructure or production setting.

## Finding (RV-13)

The Edge Function called `request.text()` before authentication with no size bound and no rate limit, so
malformed or hostile requests could consume memory/CPU/log volume.

## Decisions

- **Order**: method check, then rate checks, then bounded body read, then the unchanged SEC-007 authentication, JSON
  parse, id check and `process_sepay_webhook`. Nothing after the gate changed, so raw-body HMAC, the 5-minute timestamp
  window, fail-closed modes, exact payload validation and DB idempotency are untouched.
- **Body bound (enforced)**: default 64 KiB. Oversized `Content-Length` refused (413) before the body is opened; a body
  without Content-Length is read through a reader and cancelled when it crosses the cap (413); malformed
  Content-Length gives 400. Bodies within the cap are decoded exactly like `request.text()` so the HMAC input is byte-exact.
- **Rate limit (best effort)**: fixed window, per client key, in isolate memory. One counter for all requests (429 with
  `Retry-After`), one for failed authentications (early 429 once exhausted). Tracked keys are capped, surplus keys share
  one bucket. Only the first rejection per window is logged, no IP/header/payload ever.
- **Config**: optional env overrides; invalid/missing/out-of-range falls back to the default, so a limit cannot be disabled.
- Defaults (64 KiB, 120/min, 10 failures/min) are engineering choices, not approved requirements and not checked against
  real SePay payloads: flagged in the runbook for Test Mode confirmation.

## Limitations (explicit, do not claim more)

- Process-local counters: not shared across isolates/regions, reset on cold start. This is NOT a distributed rate limit.
- Client key derives from proxy headers; trust in them on Supabase Edge Functions is **unverified** (the Supabase docs
  search was not permitted in this session). The rightmost `X-Forwarded-For` entry is used as the conservative choice.
- A sender who can spoof the SePay address could cause temporary 429s for SePay; mitigation is SePay retry plus idempotency,
  which is **not verified** (needs Test Mode).
- Robust enforcement requires an Owner/DevOps decision on a gateway/WAF or provider IP allowlist. No infrastructure was
  created and no production setting changed.

## Tests

`tests/unit/functions/request-limits.test.ts`: config fallback, client key derivation, window counter (limits, expiry,
key cap), bounded body reader (exact cap, declared length without opening the body, endless stream cancelled, chunked
multibyte reassembly, malformed Content-Length, stream failure), gate order (413/400/429, rate limit before body read,
window reset, auth-failure early block), and gate + `authenticateWebhook` (valid HMAC over the byte-exact body still passes,
tampered body still rejected).

Not done: no Edge runtime / `supabase functions serve` smoke (Docker engine unavailable in this workspace), no integration
test that sends a real oversized HTTP request, no staging verification.

## Acceptance (evidence)

### Codex review correction

The initial helper had no read deadline and awaited cancellation, allowing stalled unauthenticated
bodies to hold requests indefinitely. Codex added a total 10-second body deadline (bounded configurable
1–30 seconds) and nonblocking cancellation, with 408 before authentication. Regression tests cover a
tiny unfinished body, trickling input, a never-settling cancellation callback, timer cleanup, gate 408
and configuration fallback. Full pipeline, Edge smoke and staging remain pending coordinator validation.
The inherited Claude attempt stays in progress until task:finish records actual evidence.

- Bounded body before JSON parse: unit-tested, enforced.
- Rate limiting with explicit limitations: implemented best effort, documented; distributed enforcement NOT claimed.
- Auth/idempotency preserved: existing `webhook-auth` and `sepay-payload` tests unchanged and passing; new gate+auth test.
