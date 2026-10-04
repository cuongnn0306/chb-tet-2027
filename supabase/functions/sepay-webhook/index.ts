// Edge Function: SePay payment webhook (PAY-007).
//
// Thin, trusted adapter: authenticate the request, parse it, hand it to the database function
// process_sepay_webhook() (idempotent, all business rules live there) and answer SePay.
//
// Secrets (set with `supabase secrets set`, never committed, never VITE_*):
//   SEPAY_WEBHOOK_API_KEY       expected value of "Authorization: Apikey <key>" (SePay API-key mode)
//   SEPAY_WEBHOOK_HMAC_SECRET   SePay HMAC mode: X-SePay-Timestamp + X-SePay-Signature over
//                               "{timestamp}.{raw body}", 5-minute replay window
// The two modes are alternatives; configure the one(s) SePay is set to use. With none, every
// request is rejected.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the Edge Function runtime.
//
// Responses: 200 {"success":true} when the event was handled (including duplicates and events that
// need review: those are stored, retrying would change nothing); 400 for an unusable payload;
// 401 when authentication fails; 408 when the body-read deadline expires; 413 for an oversized body;
// 429 (with Retry-After) when
// the best-effort rate limit trips; 500 for a temporary failure so SePay retries.
// Logging (SEC-009): one JSON line per notable event with a stable reason, a per-request correlation
// id and, for database failures, the SQLSTATE; never payloads, headers, keys, addresses or exception
// messages. See _shared/safe-log.ts.
// Optional overrides (defaults apply when unset/invalid; limits cannot be disabled):
//   SEPAY_WEBHOOK_MAX_BODY_BYTES, SEPAY_WEBHOOK_RATE_LIMIT_PER_MINUTE,
//   SEPAY_WEBHOOK_AUTH_FAILURES_PER_MINUTE, SEPAY_WEBHOOK_BODY_TIMEOUT_MS
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, authenticateWebhook } from '../_shared/webhook-auth.ts'
import { hasRepresentableId } from '../_shared/sepay-payload.ts'
import { createRequestGate, loadRequestGateConfig } from '../_shared/request-limits.ts'
import {
  createWebhookLogger,
  toErrorName,
  toLogReason,
  toSqlState,
  type WebhookLogger,
} from '../_shared/safe-log.ts'

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

// SEC-006: bounded body read + best-effort per-isolate rate limit, both before authentication.
// The rate counters are process-local (not shared across isolates): see _shared/request-limits.ts.
const gate = createRequestGate(loadRequestGateConfig((name) => Deno.env.get(name)))

async function handle(request: Request, logger: WebhookLogger): Promise<Response> {
  if (request.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)

  const admission = await gate.admit(request)
  if (!admission.ok) {
    if (admission.logReason) {
      logger.log({ level: 'warn', event: 'rejected', reason: toLogReason(admission.logReason) })
    }
    return json(
      { success: false, error: admission.error },
      admission.status,
      admission.retryAfterSeconds ? { 'Retry-After': String(admission.retryAfterSeconds) } : {},
    )
  }
  const rawBody = admission.rawBody

  const auth = await authenticateWebhook(
    {
      authorization: request.headers.get('authorization'),
      signature: request.headers.get(SIGNATURE_HEADER),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      rawBody,
    },
    {
      apiKey: Deno.env.get('SEPAY_WEBHOOK_API_KEY'),
      hmacSecret: Deno.env.get('SEPAY_WEBHOOK_HMAC_SECRET'),
    },
  )
  if (!auth.ok) {
    // Stable reason only (SEC-009): never the headers, the key, the client address or the payload.
    const failure = gate.recordAuthFailure(admission.clientKey)
    if (failure.logReason) {
      logger.log({ level: 'warn', event: 'rejected', reason: toLogReason(failure.logReason) })
    }
    logger.log({ level: 'warn', event: 'unauthorized', reason: toLogReason(auth.reason) })
    return json({ success: false, error: 'unauthorized' }, 401)
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    // the SyntaxError message can quote part of the body: it is deliberately not read
    logger.log({ level: 'warn', event: 'bad_request', reason: 'invalid_json' })
    return json({ success: false, error: 'invalid_json' }, 400)
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    logger.log({ level: 'warn', event: 'bad_request', reason: 'invalid_payload' })
    return json({ success: false, error: 'invalid_payload' }, 400)
  }
  if (!hasRepresentableId(payload as Record<string, unknown>)) {
    // a numeric id beyond 2^53 was already rounded by JSON.parse: it could collide with another id
    logger.log({ level: 'warn', event: 'bad_request', reason: 'invalid_id' })
    return json({ success: false, error: 'invalid_id' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data, error } = await supabase.rpc('process_sepay_webhook', { p_payload: payload })
  if (error) {
    // Only the SQLSTATE: error.message/details/hint can quote payload or column values.
    const permanent = error.code === 'P0001'
    logger.log({
      level: 'error',
      event: 'failed',
      reason: permanent ? 'rpc_rejected' : 'rpc_error',
      sqlState: toSqlState(error.code),
    })
    // P0001 = our own validation (e.g. missing transaction id): retrying cannot fix it.
    return json({ success: false, error: 'rejected' }, permanent ? 400 : 500)
  }
  return json({ success: true, status: (data as { status?: string } | null)?.status ?? null })
}

Deno.serve(async (request: Request) => {
  const logger = createWebhookLogger('sepay-webhook', {
    warn: (line) => console.warn(line),
    error: (line) => console.error(line),
  })
  try {
    return await handle(request, logger)
  } catch (thrown) {
    // An exception can carry request or database content in its message: log the class name only.
    // 500 so SePay retries, as before (an unhandled throw was a 500 too).
    logger.log({
      level: 'error',
      event: 'failed',
      reason: 'unexpected_exception',
      errorName: toErrorName(thrown),
    })
    return json({ success: false, error: 'internal_error' }, 500)
  }
})
