/**
 * Webhook request authentication (PAY-007, SEC-007). Pure Web-API code (no Deno globals) so it runs
 * in the Edge Function runtime and in unit tests.
 *
 * Two alternative SePay modes (https://developer.sepay.vn/en/sepay-webhooks/xac-thuc):
 *  - API key: `Authorization: Apikey <key>` (proves the sender only).
 *  - HMAC-SHA256: `X-SePay-Timestamp` (Unix seconds) + `X-SePay-Signature: sha256=<hex>` over
 *    `{timestamp}.{raw_body}`, accepted only inside a replay window (also detects a changed body).
 *
 * Fails CLOSED: with no secret configured every request is rejected. Secrets come from the function's
 * environment (`supabase secrets set ...`), never from code or the browser.
 */
const encoder = new TextEncoder()

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

/** Constant-time string comparison (both sides are hashed first so lengths do not leak). */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([sha256(a), sha256(b)])
  let diff = 0
  for (let i = 0; i < hashA.length; i++) diff |= (hashA[i] ?? 0) ^ (hashB[i] ?? 0)
  return diff === 0
}

/** "Authorization: Apikey <key>" (SePay API-key mode). The scheme is case-insensitive. */
export async function verifyApiKey(header: string | null, expected: string): Promise<boolean> {
  if (!header || !expected) return false
  const match = /^\s*apikey\s+(.+?)\s*$/i.exec(header)
  if (!match) return false
  return timingSafeEqual(match[1] ?? '', expected)
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Headers SePay sends in HMAC mode. */
export const SIGNATURE_HEADER = 'x-sepay-signature'
export const TIMESTAMP_HEADER = 'x-sepay-timestamp'

/** SePay's documented replay window: 5 minutes, applied to past and future timestamps. */
export const TIMESTAMP_TOLERANCE_SECONDS = 300

export type HmacResult =
  | { ok: true }
  | {
      ok: false
      reason: 'missing_timestamp' | 'bad_timestamp' | 'stale_timestamp' | 'bad_signature'
    }

/**
 * Verifies `sha256=<hex>` = HMAC-SHA256(secret, `${timestamp}.${rawBody}`) and that the timestamp
 * (Unix seconds) is within the tolerance of `nowMs`. The timestamp is checked before the signature
 * so a replayed request is rejected even though its signature is valid. The bare hex form (no
 * prefix) is accepted too; it carries no extra risk.
 */
export async function verifyHmacSha256(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  secret: string,
  nowMs: number = Date.now(),
  toleranceSeconds: number = TIMESTAMP_TOLERANCE_SECONDS,
): Promise<HmacResult> {
  const timestamp = timestampHeader?.trim() ?? ''
  if (timestamp === '') return { ok: false, reason: 'missing_timestamp' }
  if (!/^[0-9]{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad_timestamp' }
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSeconds) {
    return { ok: false, reason: 'stale_timestamp' }
  }
  if (!signatureHeader || !secret) return { ok: false, reason: 'bad_signature' }

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = toHex(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`)),
  )
  const given = signatureHeader
    .trim()
    .replace(/^sha256=/i, '')
    .toLowerCase()
  return (await timingSafeEqual(given, expected))
    ? { ok: true }
    : { ok: false, reason: 'bad_signature' }
}

export interface WebhookRequestParts {
  authorization: string | null
  signature: string | null
  timestamp: string | null
  rawBody: string
}

export interface WebhookAuthConfig {
  apiKey?: string
  hmacSecret?: string
}

export type AuthResult = { ok: true } | { ok: false; reason: string }

/**
 * The two SePay modes are alternatives, so a request needs to satisfy only the mode it uses:
 *  - it carries an HMAC signature and an HMAC secret is configured: the signature decides (a bad
 *    or stale one is never rescued by an API key, so a downgrade needs the API key itself);
 *  - otherwise an API key, when configured, decides;
 *  - HMAC configured only and no signature sent: rejected.
 * If neither secret is configured the request is rejected, so a missing secret can never leave
 * the endpoint open.
 */
export async function authenticateWebhook(
  request: WebhookRequestParts,
  config: WebhookAuthConfig,
  nowMs: number = Date.now(),
): Promise<AuthResult> {
  const apiKey = config.apiKey?.trim()
  const hmacSecret = config.hmacSecret?.trim()
  if (!apiKey && !hmacSecret) return { ok: false, reason: 'no_secret_configured' }

  if (hmacSecret && request.signature) {
    const result = await verifyHmacSha256(
      request.rawBody,
      request.signature,
      request.timestamp,
      hmacSecret,
      nowMs,
    )
    return result.ok ? { ok: true } : result
  }
  if (apiKey) {
    return (await verifyApiKey(request.authorization, apiKey))
      ? { ok: true }
      : { ok: false, reason: 'bad_api_key' }
  }
  return { ok: false, reason: 'missing_signature' }
}
