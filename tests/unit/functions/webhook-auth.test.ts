import { describe, expect, it } from 'vitest'
import {
  TIMESTAMP_TOLERANCE_SECONDS,
  authenticateWebhook,
  timingSafeEqual,
  verifyApiKey,
  verifyHmacSha256,
} from '../../../supabase/functions/_shared/webhook-auth'

/**
 * Provider contract fixture (https://developer.sepay.vn/en/sepay-webhooks/xac-thuc):
 * `X-SePay-Signature: sha256=<hex>` where hex = HMAC-SHA256(secret, "{timestamp}.{raw body}") and
 * `X-SePay-Timestamp` is Unix seconds. The vector below was computed independently with
 * node:crypto (not with the code under test) using a fake secret.
 */
const SECRET = 'fixture-secret-not-real'
const BODY =
  '{"id":92704,"gateway":"MBBank","transferType":"in","transferAmount":150000,"code":"TET000123"}'
const TIMESTAMP = '1790000000'
const SIGNATURE = 'sha256=b7d2e35ba97ac113e57bfd42657d0e5d71eebb6f8b849ac39ad0ccdc8305ee88'
/** The old, wrong contract: HMAC over the body only. */
const BODY_ONLY_SIGNATURE = '5617d7b19eecb0cddcdc2cb0709481c9086217cfb7ca0134e31d64cd17699c92'
const NOW_MS = Number(TIMESTAMP) * 1000

/** Independent signer used to build other cases (mirrors the documented PHP example). */
async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const bytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)),
  )
  return `sha256=${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

describe('timingSafeEqual', () => {
  it('compares equal and different strings, including different lengths', async () => {
    expect(await timingSafeEqual('abc', 'abc')).toBe(true)
    expect(await timingSafeEqual('abc', 'abd')).toBe(false)
    expect(await timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(await timingSafeEqual('', '')).toBe(true)
    expect(await timingSafeEqual('', 'x')).toBe(false)
  })
})

describe('verifyApiKey (Authorization: Apikey <key>)', () => {
  it('accepts the right key with a case-insensitive scheme', async () => {
    expect(await verifyApiKey('Apikey s3cret', 's3cret')).toBe(true)
    expect(await verifyApiKey('apikey   s3cret  ', 's3cret')).toBe(true)
    expect(await verifyApiKey('APIKEY s3cret', 's3cret')).toBe(true)
  })

  it('rejects wrong keys, other schemes, missing headers and empty expectations', async () => {
    expect(await verifyApiKey('Apikey wrong', 's3cret')).toBe(false)
    expect(await verifyApiKey('Bearer s3cret', 's3cret')).toBe(false)
    expect(await verifyApiKey('s3cret', 's3cret')).toBe(false)
    expect(await verifyApiKey(null, 's3cret')).toBe(false)
    expect(await verifyApiKey('Apikey ', 's3cret')).toBe(false)
    expect(await verifyApiKey('Apikey x', '')).toBe(false)
  })
})

describe('verifyHmacSha256 ({timestamp}.{raw body})', () => {
  const verify = (
    over: Partial<{
      body: string
      signature: string | null
      timestamp: string | null
      secret: string
      now: number
    }> = {},
  ) =>
    verifyHmacSha256(
      over.body ?? BODY,
      over.signature === undefined ? SIGNATURE : over.signature,
      over.timestamp === undefined ? TIMESTAMP : over.timestamp,
      over.secret ?? SECRET,
      over.now ?? NOW_MS,
    )

  it('accepts the provider-contract fixture (sha256= prefix, Unix-second timestamp)', async () => {
    expect(await verify()).toEqual({ ok: true })
    // the fixture really is what the contract says, not only what our helper computes
    expect(await sign(SECRET, TIMESTAMP, BODY)).toBe(SIGNATURE)
  })

  it('also accepts the bare hex form and upper case', async () => {
    expect(await verify({ signature: SIGNATURE.replace('sha256=', '') })).toEqual({ ok: true })
    expect(await verify({ signature: SIGNATURE.toUpperCase() })).toEqual({ ok: true })
  })

  it('rejects a body-only signature (the old contract) even with a fresh timestamp', async () => {
    expect(await verify({ signature: BODY_ONLY_SIGNATURE })).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it('rejects a modified body, a wrong secret and a missing or garbled signature', async () => {
    const tampered = BODY.replace('150000', '1')
    expect(await verify({ body: tampered })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(await verify({ body: `${BODY} ` })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(await verify({ secret: 'another-secret' })).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
    expect(await verify({ signature: null })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(await verify({ signature: 'sha256=deadbeef' })).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
    expect(await verify({ secret: '' })).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a signature that was made for another timestamp', async () => {
    // valid signature for timestamp T, replayed with T+1 (still in the window): the signed text differs
    expect(await verify({ timestamp: String(Number(TIMESTAMP) + 1) })).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it('rejects a missing or malformed timestamp', async () => {
    expect(await verify({ timestamp: null })).toEqual({ ok: false, reason: 'missing_timestamp' })
    expect(await verify({ timestamp: '  ' })).toEqual({ ok: false, reason: 'missing_timestamp' })
    for (const bad of [
      'abc',
      '17900000.5',
      '-1790000000',
      '1790000000000000000000',
      '0x6a',
      '1790000000 1',
    ]) {
      expect(await verify({ timestamp: bad })).toEqual({ ok: false, reason: 'bad_timestamp' })
    }
  })

  it('rejects timestamps outside the 5-minute window, past or future, with a valid signature', async () => {
    expect(TIMESTAMP_TOLERANCE_SECONDS).toBe(300)
    const at = async (offsetSeconds: number) => {
      const ts = String(Number(TIMESTAMP) + offsetSeconds)
      return verify({ timestamp: ts, signature: await sign(SECRET, ts, BODY) })
    }
    expect(await at(0)).toEqual({ ok: true })
    expect(await at(-300)).toEqual({ ok: true }) // exactly at the edge: still accepted
    expect(await at(300)).toEqual({ ok: true })
    expect(await at(-301)).toEqual({ ok: false, reason: 'stale_timestamp' })
    expect(await at(301)).toEqual({ ok: false, reason: 'stale_timestamp' })
    expect(await at(-86400)).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('rejects a replay: the same valid request later than the window', async () => {
    expect(await verify({ now: NOW_MS + 299_000 })).toEqual({ ok: true })
    expect(await verify({ now: NOW_MS + 301_000 })).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    })
  })
})

describe('authenticateWebhook', () => {
  const request = (
    over: Partial<{
      authorization: string | null
      signature: string | null
      timestamp: string | null
      rawBody: string
    }> = {},
  ) => ({
    authorization: null,
    signature: SIGNATURE,
    timestamp: TIMESTAMP,
    rawBody: BODY,
    ...over,
  })
  const auth = (
    req: ReturnType<typeof request>,
    config: { apiKey?: string; hmacSecret?: string },
  ) => authenticateWebhook(req, config, NOW_MS)

  it('fails closed when no secret is configured, whatever the request carries', async () => {
    const expected = { ok: false, reason: 'no_secret_configured' }
    expect(await auth(request(), {})).toEqual(expected)
    expect(await auth(request({ authorization: 'Apikey anything' }), {})).toEqual(expected)
    expect(await auth(request(), { apiKey: '  ', hmacSecret: '' })).toEqual(expected)
  })

  it('HMAC mode: accepts the provider fixture', async () => {
    expect(await auth(request(), { hmacSecret: SECRET })).toEqual({ ok: true })
  })

  it('HMAC mode: rejects wrong secret, changed body, bad/missing/stale timestamp', async () => {
    const cfg = { hmacSecret: SECRET }
    expect(await auth(request(), { hmacSecret: 'other' })).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
    expect(await auth(request({ rawBody: BODY.replace('150000', '1') }), cfg)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
    expect(await auth(request({ timestamp: null }), cfg)).toEqual({
      ok: false,
      reason: 'missing_timestamp',
    })
    expect(await auth(request({ timestamp: 'now' }), cfg)).toEqual({
      ok: false,
      reason: 'bad_timestamp',
    })
    expect(await authenticateWebhook(request(), cfg, NOW_MS + 400_000)).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    })
  })

  it('HMAC mode: rejects a request without a signature (an API key does not count)', async () => {
    expect(
      await auth(request({ signature: null, authorization: 'Apikey s3cret' }), {
        hmacSecret: SECRET,
      }),
    ).toEqual({ ok: false, reason: 'missing_signature' })
  })

  it('API-key mode: accepts the right key and rejects wrong or missing ones', async () => {
    const cfg = { apiKey: 's3cret' }
    const plain = { signature: null, timestamp: null }
    expect(await auth(request({ ...plain, authorization: 'Apikey s3cret' }), cfg)).toEqual({
      ok: true,
    })
    expect(await auth(request({ ...plain, authorization: 'Apikey nope' }), cfg)).toEqual({
      ok: false,
      reason: 'bad_api_key',
    })
    expect(await auth(request({ ...plain }), cfg)).toEqual({ ok: false, reason: 'bad_api_key' })
  })

  it('both configured: either mode works, but a signature that is sent must be valid', async () => {
    const both = { apiKey: 's3cret', hmacSecret: SECRET }
    // HMAC mode request
    expect(await auth(request(), both)).toEqual({ ok: true })
    // API-key mode request (no signature headers)
    expect(
      await auth(
        request({ signature: null, timestamp: null, authorization: 'Apikey s3cret' }),
        both,
      ),
    ).toEqual({ ok: true })
    // a tampered or stale signature is not rescued by a valid API key
    expect(
      await auth(
        request({ rawBody: BODY.replace('150000', '1'), authorization: 'Apikey s3cret' }),
        both,
      ),
    ).toEqual({ ok: false, reason: 'bad_signature' })
    expect(
      await authenticateWebhook(
        request({ authorization: 'Apikey s3cret' }),
        both,
        NOW_MS + 400_000,
      ),
    ).toEqual({ ok: false, reason: 'stale_timestamp' })
    // nothing valid at all
    expect(await auth(request({ signature: null, timestamp: null }), both)).toEqual({
      ok: false,
      reason: 'bad_api_key',
    })
  })
})
