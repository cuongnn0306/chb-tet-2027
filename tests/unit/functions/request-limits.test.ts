import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AUTH_FAILURES_PER_WINDOW,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_BODY_TIMEOUT_MS,
  DEFAULT_REQUESTS_PER_WINDOW,
  WindowedCounter,
  clientKeyFrom,
  createRequestGate,
  loadRequestGateConfig,
  readBodyWithLimit,
  type RequestGateConfig,
} from '../../../supabase/functions/_shared/request-limits'
import { authenticateWebhook } from '../../../supabase/functions/_shared/webhook-auth'

const CONFIG: RequestGateConfig = {
  maxBodyBytes: 1_024,
  bodyTimeoutMs: DEFAULT_BODY_TIMEOUT_MS,
  requestsPerWindow: 3,
  authFailuresPerWindow: 2,
  windowMs: 60_000,
  maxKeys: 4,
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/sepay-webhook', { method: 'POST', body, headers })
}

/** A request whose body is delivered in chunks, with no Content-Length (like chunked transfer). */
function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Request('http://localhost/sepay-webhook', {
    method: 'POST',
    body: stream,
    headers,
    // required by undici when the body is a stream
    duplex: 'half',
  } as RequestInit)
}

describe('loadRequestGateConfig', () => {
  it('uses the defaults when nothing is configured', () => {
    const config = loadRequestGateConfig(() => undefined)
    expect(config.maxBodyBytes).toBe(DEFAULT_MAX_BODY_BYTES)
    expect(config.bodyTimeoutMs).toBe(DEFAULT_BODY_TIMEOUT_MS)
    expect(config.requestsPerWindow).toBe(DEFAULT_REQUESTS_PER_WINDOW)
    expect(config.authFailuresPerWindow).toBe(DEFAULT_AUTH_FAILURES_PER_WINDOW)
  })

  it('accepts valid overrides', () => {
    const env: Record<string, string> = {
      SEPAY_WEBHOOK_MAX_BODY_BYTES: '4096',
      SEPAY_WEBHOOK_RATE_LIMIT_PER_MINUTE: '30',
      SEPAY_WEBHOOK_AUTH_FAILURES_PER_MINUTE: '5',
      SEPAY_WEBHOOK_BODY_TIMEOUT_MS: '5000',
    }
    const config = loadRequestGateConfig((name) => env[name])
    expect(config.maxBodyBytes).toBe(4096)
    expect(config.requestsPerWindow).toBe(30)
    expect(config.authFailuresPerWindow).toBe(5)
    expect(config.bodyTimeoutMs).toBe(5_000)
  })

  it.each(['0', '-5', 'abc', '', '1.5', '99999999999', '0x10'])(
    'falls back to the default for the invalid value %j (a limit can never be disabled)',
    (value) => {
      const config = loadRequestGateConfig(() => value)
      expect(config.maxBodyBytes).toBe(DEFAULT_MAX_BODY_BYTES)
      expect(config.requestsPerWindow).toBe(DEFAULT_REQUESTS_PER_WINDOW)
      expect(config.authFailuresPerWindow).toBe(DEFAULT_AUTH_FAILURES_PER_WINDOW)
      expect(config.bodyTimeoutMs).toBe(DEFAULT_BODY_TIMEOUT_MS)
    },
  )

  it('rejects an out-of-range body cap rather than raising it', () => {
    const config = loadRequestGateConfig((name) =>
      name === 'SEPAY_WEBHOOK_MAX_BODY_BYTES' ? '999999999' : undefined,
    )
    expect(config.maxBodyBytes).toBe(DEFAULT_MAX_BODY_BYTES)
  })

  it.each(['999', '30001'])('rejects an out-of-range body deadline %s', (value) => {
    expect(
      loadRequestGateConfig((name) =>
        name === 'SEPAY_WEBHOOK_BODY_TIMEOUT_MS' ? value : undefined,
      ).bodyTimeoutMs,
    ).toBe(DEFAULT_BODY_TIMEOUT_MS)
  })
})

describe('clientKeyFrom', () => {
  it('prefers the CDN header', () => {
    const headers = new Headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1' })
    expect(clientKeyFrom(headers)).toBe('203.0.113.9')
  })

  it('uses the rightmost forwarded entry, not the client-controlled leftmost one', () => {
    const headers = new Headers({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' })
    expect(clientKeyFrom(headers)).toBe('198.51.100.7')
  })

  it('falls back to x-real-ip, then to one shared bucket', () => {
    expect(clientKeyFrom(new Headers({ 'x-real-ip': '192.0.2.4' }))).toBe('192.0.2.4')
    expect(clientKeyFrom(new Headers())).toBe('unknown')
  })

  it('ignores values that are not addresses', () => {
    expect(clientKeyFrom(new Headers({ 'x-forwarded-for': 'a'.repeat(200) }))).toBe('unknown')
    expect(clientKeyFrom(new Headers({ 'cf-connecting-ip': 'evil key; drop' }))).toBe('unknown')
  })
})

describe('WindowedCounter', () => {
  it('allows up to the limit then refuses until the window ends', () => {
    const counter = new WindowedCounter(2, 1_000, 10)
    expect(counter.hit('a', 0).allowed).toBe(true)
    expect(counter.hit('a', 100).allowed).toBe(true)
    const third = counter.hit('a', 200)
    expect(third.allowed).toBe(false)
    expect(third.count).toBe(3)
    expect(third.retryAfterSeconds).toBe(1)
    expect(counter.hit('a', 1_000).allowed).toBe(true)
  })

  it('counts keys independently', () => {
    const counter = new WindowedCounter(1, 1_000, 10)
    expect(counter.hit('a', 0).allowed).toBe(true)
    expect(counter.hit('b', 0).allowed).toBe(true)
    expect(counter.hit('a', 1).allowed).toBe(false)
  })

  it('does not grow past maxKeys: surplus keys share one bucket', () => {
    const counter = new WindowedCounter(2, 1_000, 2)
    counter.hit('a', 0)
    counter.hit('b', 0)
    expect(counter.hit('c', 0).allowed).toBe(true)
    expect(counter.hit('d', 0).allowed).toBe(true)
    // the shared bucket is now over its limit for every further new key
    expect(counter.hit('e', 0).allowed).toBe(false)
    expect(counter.isExhausted('f', 0).allowed).toBe(false)
  })

  it('reclaims expired keys before sharing a bucket', () => {
    const counter = new WindowedCounter(1, 1_000, 2)
    counter.hit('a', 0)
    counter.hit('b', 0)
    expect(counter.hit('c', 2_000).allowed).toBe(true)
    expect(counter.hit('c', 2_001).allowed).toBe(false)
    expect(counter.hit('d', 2_002).allowed).toBe(true)
  })

  it('isExhausted does not count and reports the current state', () => {
    const counter = new WindowedCounter(2, 1_000, 10)
    expect(counter.isExhausted('a', 0).allowed).toBe(true)
    counter.hit('a', 0)
    counter.hit('a', 1)
    expect(counter.isExhausted('a', 2).allowed).toBe(false)
    expect(counter.isExhausted('a', 2).count).toBe(2)
    expect(counter.isExhausted('a', 1_001).allowed).toBe(true)
  })
})

describe('readBodyWithLimit', () => {
  it('bounds an unfinished tiny body even when cancellation never settles', async () => {
    vi.useFakeTimers()
    try {
      let cancelled = false
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([1]))
        },
        cancel() {
          cancelled = true
          return new Promise<void>(() => {})
        },
      })
      const result = readBodyWithLimit({ headers: new Headers(), body } as Request, 1_024, 50)
      await vi.advanceTimersByTimeAsync(50)
      expect(await result).toEqual({ ok: false, reason: 'read_timeout' })
      expect(cancelled).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns oversize immediately even when cancellation never settles', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(1_025))
      },
      cancel() {
        return new Promise<void>(() => {})
      },
    })
    expect(await readBodyWithLimit({ headers: new Headers(), body } as Request, 1_024)).toEqual({
      ok: false,
      reason: 'too_large',
    })
  })

  it('uses a total deadline, not a timer that resets with every arriving chunk', async () => {
    vi.useFakeTimers()
    let senderTimer: ReturnType<typeof setInterval> | undefined
    try {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          senderTimer = setInterval(() => c.enqueue(new Uint8Array([1])), 10)
        },
        cancel() {
          clearInterval(senderTimer)
        },
      })
      const result = readBodyWithLimit({ headers: new Headers(), body } as Request, 1_024, 50)
      await vi.advanceTimersByTimeAsync(50)
      expect(await result).toEqual({ ok: false, reason: 'read_timeout' })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      clearInterval(senderTimer)
      vi.useRealTimers()
    }
  })
  it('returns the exact text of a body within the cap', async () => {
    const text = '{"id":1,"content":"chuyển khoản TET000123"}'
    const result = await readBodyWithLimit(post(text), 1_024)
    expect(result).toEqual({ ok: true, text, bytes: new TextEncoder().encode(text).length })
  })

  it('treats an empty body as empty text', async () => {
    const result = await readBodyWithLimit(new Request('http://localhost/', { method: 'POST' }), 10)
    expect(result).toEqual({ ok: true, text: '', bytes: 0 })
  })

  it('accepts a body of exactly the cap and refuses one byte more', async () => {
    expect((await readBodyWithLimit(post('x'.repeat(10)), 10)).ok).toBe(true)
    expect(await readBodyWithLimit(post('x'.repeat(11)), 10)).toEqual({
      ok: false,
      reason: 'too_large',
    })
  })

  it('refuses on the declared Content-Length without reading the stream', async () => {
    let opened = false
    const body = {
      getReader() {
        opened = true
        throw new Error('the body must not be opened')
      },
    }
    const request = {
      headers: new Headers({ 'content-length': '5000' }),
      body,
    } as unknown as Request
    expect(await readBodyWithLimit(request, 1_024)).toEqual({ ok: false, reason: 'too_large' })
    expect(opened).toBe(false)
  })

  it('stops a streamed body (no Content-Length) as soon as it crosses the cap', async () => {
    let produced = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1
        controller.enqueue(new Uint8Array(400))
      },
      cancel() {
        cancelled = true
      },
    })
    const request = { headers: new Headers(), body: stream } as unknown as Request
    expect(await readBodyWithLimit(request, 1_000)).toEqual({ ok: false, reason: 'too_large' })
    expect(cancelled).toBe(true)
    // an endless body must not be consumed: three 400-byte chunks cross 1000 bytes
    expect(produced).toBeLessThan(10)
  })

  it('reassembles a chunked body that fits the cap, including a split multibyte character', async () => {
    const bytes = new TextEncoder().encode('{"content":"Tết"}')
    const split = bytes.length - 5 // inside the three-byte "ế"
    const result = await readBodyWithLimit(
      streamed([bytes.slice(0, split), bytes.slice(split)]),
      1_024,
    )
    expect(result).toEqual({ ok: true, text: '{"content":"Tết"}', bytes: bytes.length })
  })

  it.each(['abc', '-1', '1e3', '', '12 34', '1.5'])(
    'refuses the malformed Content-Length %j',
    async (value) => {
      const request = { headers: new Headers({ 'content-length': value }), body: null } as Request
      expect(await readBodyWithLimit(request, 1_024)).toEqual({
        ok: false,
        reason: 'invalid_content_length',
      })
    },
  )

  it('reports a failing stream as read_failed', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('socket closed')
      },
    })
    const request = { headers: new Headers(), body: stream } as unknown as Request
    expect(await readBodyWithLimit(request, 1_024)).toEqual({ ok: false, reason: 'read_failed' })
  })
})

describe('createRequestGate.admit', () => {
  const headers = { 'x-forwarded-for': '198.51.100.7' }

  it('rejects unfinished bodies with 408 before authentication', async () => {
    vi.useFakeTimers()
    try {
      const gate = createRequestGate({ ...CONFIG, bodyTimeoutMs: 50 })
      const body = new ReadableStream<Uint8Array>({ start() {} })
      const result = gate.admit({ headers: new Headers(headers), body } as Request, 0)
      await vi.advanceTimersByTimeAsync(50)
      expect(await result).toMatchObject({ ok: false, status: 408, error: 'request_timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('admits a normal request and returns the raw body unchanged', async () => {
    const gate = createRequestGate(CONFIG)
    const body = '{"id":92704,"transferAmount":150000}'
    const result = await gate.admit(post(body, headers), 0)
    expect(result).toEqual({ ok: true, clientKey: '198.51.100.7', rawBody: body })
  })

  it('answers 413 for an oversized body and never returns its content', async () => {
    const gate = createRequestGate(CONFIG)
    const result = await gate.admit(post('x'.repeat(2_000), headers), 0)
    expect(result).toMatchObject({ ok: false, status: 413, error: 'payload_too_large' })
    expect(result).not.toHaveProperty('rawBody')
  })

  it('answers 400 for a malformed Content-Length', async () => {
    const gate = createRequestGate(CONFIG)
    const request = {
      headers: new Headers({ ...headers, 'content-length': 'abc' }),
      body: null,
    } as Request
    expect(await gate.admit(request, 0)).toMatchObject({
      ok: false,
      status: 400,
      error: 'invalid_content_length',
    })
  })

  it('rate limits per client key with Retry-After and logs only the first rejection', async () => {
    const gate = createRequestGate(CONFIG)
    for (let i = 0; i < CONFIG.requestsPerWindow; i++) {
      expect((await gate.admit(post('{}', headers), i)).ok).toBe(true)
    }
    const first = await gate.admit(post('{}', headers), 10)
    expect(first).toMatchObject({ ok: false, status: 429, error: 'rate_limited' })
    expect(first.ok === false && first.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    expect(first.ok === false && first.logReason).toBe('rate_limited')
    const second = await gate.admit(post('{}', headers), 11)
    expect(second.ok === false && second.logReason).toBeUndefined()
    // a different sender is unaffected
    expect((await gate.admit(post('{}', { 'x-forwarded-for': '192.0.2.50' }), 12)).ok).toBe(true)
  })

  it('rate limits before reading the body', async () => {
    const gate = createRequestGate({ ...CONFIG, requestsPerWindow: 1 })
    await gate.admit(post('{}', headers), 0)
    let opened = false
    const body = {
      getReader() {
        opened = true
        throw new Error('the body must not be opened')
      },
    }
    const request = { headers: new Headers(headers), body } as unknown as Request
    expect(await gate.admit(request, 1)).toMatchObject({ ok: false, status: 429 })
    expect(opened).toBe(false)
  })

  it('starts a fresh window after windowMs', async () => {
    const gate = createRequestGate({ ...CONFIG, requestsPerWindow: 1 })
    expect((await gate.admit(post('{}', headers), 0)).ok).toBe(true)
    expect((await gate.admit(post('{}', headers), 1)).ok).toBe(false)
    expect((await gate.admit(post('{}', headers), CONFIG.windowMs)).ok).toBe(true)
  })

  it('refuses a key early once it has failed authentication too often', async () => {
    const gate = createRequestGate(CONFIG)
    const admitted = await gate.admit(post('{}', headers), 0)
    if (!admitted.ok) throw new Error('expected admission')
    expect(gate.recordAuthFailure(admitted.clientKey, 1).logReason).toBeUndefined()
    expect(gate.recordAuthFailure(admitted.clientKey, 2).logReason).toBe(
      'auth_failure_limit_reached',
    )
    const blocked = await gate.admit(post('{}', headers), 3)
    expect(blocked).toMatchObject({ ok: false, status: 429, error: 'rate_limited' })
    // another sender is not blocked, and the block lapses with the window
    expect((await gate.admit(post('{}', { 'x-forwarded-for': '192.0.2.50' }), 4)).ok).toBe(true)
    expect((await gate.admit(post('{}', headers), CONFIG.windowMs + 3)).ok).toBe(true)
  })
})

describe('gate in front of authentication', () => {
  const SECRET = 'fixture-secret-not-real'
  const TIMESTAMP = '1790000000'
  const NOW_MS = Number(TIMESTAMP) * 1000

  async function sign(body: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const bytes = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${TIMESTAMP}.${body}`)),
    )
    return `sha256=${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
  }

  it('keeps the raw body byte-exact so a valid HMAC still verifies after the bounded read', async () => {
    const gate = createRequestGate(CONFIG)
    // spacing and non-ASCII must survive: the signature covers the exact bytes SePay sent
    const body = '{ "id": 92704,  "content": "Chuyển khoản TET000123" }\n'
    const request = post(body, {
      'x-forwarded-for': '198.51.100.7',
      'x-sepay-timestamp': TIMESTAMP,
      'x-sepay-signature': await sign(body),
    })
    const admitted = await gate.admit(request, NOW_MS)
    if (!admitted.ok) throw new Error('expected admission')
    expect(admitted.rawBody).toBe(body)
    const auth = await authenticateWebhook(
      {
        authorization: null,
        signature: request.headers.get('x-sepay-signature'),
        timestamp: request.headers.get('x-sepay-timestamp'),
        rawBody: admitted.rawBody,
      },
      { hmacSecret: SECRET },
      NOW_MS,
    )
    expect(auth).toEqual({ ok: true })
  })

  it('does not weaken authentication: a tampered body is still rejected after admission', async () => {
    const gate = createRequestGate(CONFIG)
    const signed = '{"id":1,"transferAmount":1000}'
    const tampered = '{"id":1,"transferAmount":9000}'
    const request = post(tampered, {
      'x-forwarded-for': '198.51.100.7',
      'x-sepay-timestamp': TIMESTAMP,
      'x-sepay-signature': await sign(signed),
    })
    const admitted = await gate.admit(request, NOW_MS)
    if (!admitted.ok) throw new Error('expected admission')
    const auth = await authenticateWebhook(
      {
        authorization: null,
        signature: request.headers.get('x-sepay-signature'),
        timestamp: request.headers.get('x-sepay-timestamp'),
        rawBody: admitted.rawBody,
      },
      { hmacSecret: SECRET },
      NOW_MS,
    )
    expect(auth).toEqual({ ok: false, reason: 'bad_signature' })
  })
})
