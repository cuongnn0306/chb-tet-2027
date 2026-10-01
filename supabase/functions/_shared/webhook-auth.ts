/**
 * Webhook request authentication (PAY-007). Pure Web-API code (no Deno globals) so it runs in the
 * Edge Function runtime and in unit tests.
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

/** HMAC-SHA256 of the RAW request body, hex encoded; `sha256=<hex>` prefixes are accepted. */
export async function verifyHmacSha256(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody)))
  const given = signatureHeader
    .trim()
    .replace(/^sha256=/i, '')
    .toLowerCase()
  return timingSafeEqual(given, expected)
}

export interface WebhookRequestParts {
  authorization: string | null
  signature: string | null
  rawBody: string
}

export interface WebhookAuthConfig {
  apiKey?: string
  hmacSecret?: string
}

export type AuthResult = { ok: true } | { ok: false; reason: string }

/**
 * Every configured method must pass. If neither is configured the request is rejected, so a
 * missing secret can never leave the endpoint open.
 */
export async function authenticateWebhook(
  request: WebhookRequestParts,
  config: WebhookAuthConfig,
): Promise<AuthResult> {
  const apiKey = config.apiKey?.trim()
  const hmacSecret = config.hmacSecret?.trim()
  if (!apiKey && !hmacSecret) return { ok: false, reason: 'no_secret_configured' }
  if (apiKey && !(await verifyApiKey(request.authorization, apiKey))) {
    return { ok: false, reason: 'bad_api_key' }
  }
  if (hmacSecret && !(await verifyHmacSha256(request.rawBody, request.signature, hmacSecret))) {
    return { ok: false, reason: 'bad_signature' }
  }
  return { ok: true }
}
