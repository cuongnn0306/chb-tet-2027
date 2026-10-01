import { beforeAll, describe, expect, it } from 'vitest'
import {
  authenticateWebhook,
  timingSafeEqual,
  verifyApiKey,
  verifyHmacSha256,
} from '../../../supabase/functions/_shared/webhook-auth'

const body = '{"id":123,"transferAmount":150000,"code":"TET000123"}'
const hmac = async (secret: string, text = body) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const bytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)),
  )
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
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

describe('verifyHmacSha256 (raw body)', () => {
  it('accepts the correct signature, with or without a sha256= prefix and in upper case', async () => {
    const signature = await hmac('key')
    expect(await verifyHmacSha256(body, signature, 'key')).toBe(true)
    expect(await verifyHmacSha256(body, `sha256=${signature}`, 'key')).toBe(true)
    expect(await verifyHmacSha256(body, signature.toUpperCase(), 'key')).toBe(true)
  })

  it('rejects a tampered body, a wrong secret, a missing signature and an empty secret', async () => {
    const signature = await hmac('key')
    expect(await verifyHmacSha256(body.replace('150000', '1'), signature, 'key')).toBe(false)
    expect(await verifyHmacSha256(body, signature, 'other')).toBe(false)
    expect(await verifyHmacSha256(body, null, 'key')).toBe(false)
    expect(await verifyHmacSha256(body, 'deadbeef', 'key')).toBe(false)
    expect(await verifyHmacSha256(body, signature, '')).toBe(false)
  })
})

describe('authenticateWebhook', () => {
  let validSignature = ''
  beforeAll(async () => {
    validSignature = await hmac('hm')
  })
  const request = (
    over: Partial<{ authorization: string | null; signature: string | null; rawBody: string }> = {},
  ) => ({
    authorization: 'Apikey s3cret',
    signature: validSignature,
    rawBody: body,
    ...over,
  })

  it('fails closed when nothing is configured', async () => {
    expect(await authenticateWebhook(request(), {})).toEqual({
      ok: false,
      reason: 'no_secret_configured',
    })
    expect(await authenticateWebhook(request(), { apiKey: '  ', hmacSecret: '' })).toEqual({
      ok: false,
      reason: 'no_secret_configured',
    })
  })

  it('accepts a valid API key on its own', async () => {
    expect(await authenticateWebhook(request(), { apiKey: 's3cret' })).toEqual({ ok: true })
    expect(
      await authenticateWebhook(request({ authorization: 'Apikey nope' }), { apiKey: 's3cret' }),
    ).toEqual({
      ok: false,
      reason: 'bad_api_key',
    })
  })

  it('accepts a valid HMAC on its own', async () => {
    expect(await authenticateWebhook(request(), { hmacSecret: 'hm' })).toEqual({ ok: true })
    expect(await authenticateWebhook(request({ signature: null }), { hmacSecret: 'hm' })).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
    expect(
      await authenticateWebhook(request({ rawBody: body + ' ' }), { hmacSecret: 'hm' }),
    ).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  it('requires every configured method to pass', async () => {
    const both = { apiKey: 's3cret', hmacSecret: 'hm' }
    expect(await authenticateWebhook(request(), both)).toEqual({ ok: true })
    expect(await authenticateWebhook(request({ authorization: null }), both)).toEqual({
      ok: false,
      reason: 'bad_api_key',
    })
    expect(await authenticateWebhook(request({ signature: await hmac('wrong') }), both)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })
})
