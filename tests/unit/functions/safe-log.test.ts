import { describe, expect, it, vi } from 'vitest'
import indexSource from '../../../supabase/functions/sepay-webhook/index.ts?raw'
import {
  WEBHOOK_LOG_REASONS,
  createWebhookLogger,
  formatWebhookLog,
  newCorrelationId,
  toErrorName,
  toLogReason,
  toSqlState,
  type WebhookLogFields,
} from '../../../supabase/functions/_shared/safe-log'
import {
  createRequestGate,
  type RequestGateConfig,
} from '../../../supabase/functions/_shared/request-limits'
import { authenticateWebhook } from '../../../supabase/functions/_shared/webhook-auth'

// Synthetic values only: none of these is a real key, account or person.
const FAKE_API_KEY = 'synthetic-api-key-0000'
const FAKE_HMAC_SECRET = 'synthetic-hmac-secret-0000'
const FAKE_SIGNATURE = 'sha256=' + 'ab'.repeat(32)
const FAKE_ACCOUNT = '9990001112223'
const FAKE_NAME = 'NGUYEN VAN SYNTHETIC'
const FAKE_PHONE = '0900000000'
const FAKE_CONTENT = 'TET000123 thanh toan synthetic'
const FAKE_IP = '203.0.113.77'

const SENSITIVE = [
  FAKE_API_KEY,
  FAKE_HMAC_SECRET,
  FAKE_SIGNATURE,
  FAKE_ACCOUNT,
  FAKE_NAME,
  FAKE_PHONE,
  FAKE_CONTENT,
  FAKE_IP,
  'Apikey',
  'Authorization',
]

function capture() {
  const lines: string[] = []
  const logger = createWebhookLogger('sepay-webhook', {
    warn: (line) => lines.push(line),
    error: (line) => lines.push(line),
  })
  return { lines, logger }
}

function expectClean(text: string) {
  for (const value of SENSITIVE) expect(text).not.toContain(value)
}

describe('toLogReason', () => {
  it('keeps every listed reason and maps anything else to unknown', () => {
    for (const reason of WEBHOOK_LOG_REASONS) expect(toLogReason(reason)).toBe(reason)
    expect(toLogReason('bad_signature for key ' + FAKE_API_KEY)).toBe('unknown')
    expect(toLogReason(FAKE_CONTENT)).toBe('unknown')
    expect(toLogReason(undefined)).toBe('unknown')
    expect(toLogReason(42)).toBe('unknown')
    expect(toLogReason({ reason: 'bad_signature' })).toBe('unknown')
  })

  it('covers every reason the request gate and authentication can produce', async () => {
    // Drift guard: a new reason added to those modules must also be added to the allowlist, or the
    // log would degrade to "unknown" and lose its meaning.
    const config: RequestGateConfig = {
      maxBodyBytes: 1_024,
      bodyTimeoutMs: 1_000,
      requestsPerWindow: 1,
      authFailuresPerWindow: 1,
      windowMs: 60_000,
      maxKeys: 4,
    }
    const gate = createRequestGate(config)
    const reasons: Array<string | undefined> = []
    const post = (body: string, headers: Record<string, string> = {}) =>
      new Request('http://localhost/x', { method: 'POST', body, headers })

    const tooLarge = await gate.admit(post('x'.repeat(2_000)), 1_000)
    if (!tooLarge.ok) reasons.push(tooLarge.logReason)
    const badLength = await gate.admit(post('x', { 'content-length': 'abc' }), 1_000)
    if (!badLength.ok) reasons.push(badLength.logReason)
    const limited = await gate.admit(post('x'), 1_000)
    if (!limited.ok) reasons.push(limited.logReason)
    reasons.push(gate.recordAuthFailure('k', 1_000).logReason)

    const request = { authorization: null, signature: null, timestamp: null, rawBody: '{}' }
    const nowMs = 1_700_000_000_000
    const stamp = String(Math.floor(nowMs / 1000))
    const outcomes = [
      await authenticateWebhook(request, {}, nowMs),
      await authenticateWebhook(request, { hmacSecret: FAKE_HMAC_SECRET }, nowMs),
      await authenticateWebhook(
        { ...request, authorization: 'Apikey wrong' },
        { apiKey: FAKE_API_KEY },
        nowMs,
      ),
      await authenticateWebhook(
        { ...request, signature: FAKE_SIGNATURE },
        { hmacSecret: FAKE_HMAC_SECRET },
        nowMs,
      ),
      await authenticateWebhook(
        { ...request, signature: FAKE_SIGNATURE, timestamp: 'abc' },
        { hmacSecret: FAKE_HMAC_SECRET },
        nowMs,
      ),
      await authenticateWebhook(
        { ...request, signature: FAKE_SIGNATURE, timestamp: '1' },
        { hmacSecret: FAKE_HMAC_SECRET },
        nowMs,
      ),
      await authenticateWebhook(
        { ...request, signature: FAKE_SIGNATURE, timestamp: stamp },
        { hmacSecret: FAKE_HMAC_SECRET },
        nowMs,
      ),
    ]
    for (const outcome of outcomes) {
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) reasons.push(outcome.reason)
    }

    const logged = reasons.filter((r): r is string => typeof r === 'string')
    expect(logged.length).toBeGreaterThanOrEqual(9)
    for (const reason of logged) expect(toLogReason(reason), reason).not.toBe('unknown')
  })
})

describe('toSqlState', () => {
  it('accepts only the five-character SQLSTATE shape', () => {
    expect(toSqlState('P0001')).toBe('P0001')
    expect(toSqlState('23505')).toBe('23505')
    expect(toSqlState('XX000')).toBe('XX000')
    for (const bad of [
      '',
      'p0001',
      'P000',
      'P00011',
      'P0 01',
      `duplicate key value (${FAKE_ACCOUNT})`,
      FAKE_NAME,
      undefined,
      null,
      42,
    ]) {
      expect(toSqlState(bad)).toBe('unknown')
    }
  })
})

describe('toErrorName', () => {
  it('returns standard class names only, never the message', () => {
    expect(toErrorName(new TypeError(`bad ${FAKE_API_KEY}`))).toBe('TypeError')
    expect(toErrorName(new Error(FAKE_CONTENT))).toBe('Error')
    // AbortError is allowlisted (useful for timeouts); its message is still never read
    const abort = new DOMException(FAKE_NAME, 'AbortError')
    expect(toErrorName(abort)).toBe('AbortError')
    expect(toErrorName(abort)).not.toContain(FAKE_NAME)
  })

  it('does not trust a custom or forged name', () => {
    class LeakyError extends Error {
      constructor() {
        super(FAKE_CONTENT)
        this.name = `Leaky ${FAKE_ACCOUNT}`
      }
    }
    expect(toErrorName(new LeakyError())).toBe('unknown')
    expect(toErrorName({ name: 'TypeError', message: FAKE_CONTENT })).toBe('unknown')
    expect(toErrorName(FAKE_CONTENT)).toBe('unknown')
    expect(toErrorName(null)).toBe('unknown')
  })

  it('does not quote the body when JSON.parse fails', () => {
    const body = `{"accountNumber":"${FAKE_ACCOUNT}","content":"${FAKE_CONTENT}",`
    let thrown: unknown
    try {
      JSON.parse(body)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(SyntaxError)
    const { lines, logger } = capture()
    logger.log({
      level: 'error',
      event: 'failed',
      reason: 'unexpected_exception',
      errorName: toErrorName(thrown),
    })
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ error_name: 'SyntaxError' })
    expectClean(lines[0] ?? '')
  })
})

describe('correlation id', () => {
  it('is 32 hex characters and differs per call', () => {
    const a = newCorrelationId()
    const b = newCorrelationId()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(b).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })

  it('is repeated on every line of one request and differs between requests', () => {
    const first = capture()
    first.logger.log({ level: 'warn', event: 'rejected', reason: 'rate_limited' })
    first.logger.log({ level: 'warn', event: 'unauthorized', reason: 'bad_signature' })
    const second = capture()
    second.logger.log({ level: 'warn', event: 'unauthorized', reason: 'bad_signature' })

    const ids = first.lines.map((line) => JSON.parse(line).cid)
    expect(ids[0]).toBe(first.logger.correlationId)
    expect(ids[1]).toBe(ids[0])
    expect(JSON.parse(second.lines[0] ?? '{}').cid).not.toBe(ids[0])
  })

  it('is replaced when a caller supplies something that is not a generated id', () => {
    const line = formatWebhookLog('sepay-webhook', `${FAKE_NAME} ${FAKE_PHONE}`, {
      level: 'warn',
      event: 'rejected',
      reason: 'rate_limited',
    })
    expect(JSON.parse(line).cid).toBe('invalid')
    expectClean(line)
  })
})

describe('log line shape', () => {
  it('is one JSON object with only the allowlisted keys', () => {
    const { lines, logger } = capture()
    logger.log({
      level: 'error',
      event: 'failed',
      reason: 'rpc_error',
      sqlState: '40001',
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('\n')
    const parsed = JSON.parse(lines[0] ?? '{}')
    expect(Object.keys(parsed).sort()).toEqual([
      'cid',
      'event',
      'fn',
      'level',
      'reason',
      'sql_state',
    ])
    expect(parsed).toMatchObject({
      fn: 'sepay-webhook',
      level: 'error',
      event: 'failed',
      reason: 'rpc_error',
      sql_state: '40001',
    })
  })

  it('omits optional fields that were not given', () => {
    const { lines, logger } = capture()
    logger.log({ level: 'warn', event: 'unauthorized', reason: 'missing_signature' })
    expect(Object.keys(JSON.parse(lines[0] ?? '{}')).sort()).toEqual([
      'cid',
      'event',
      'fn',
      'level',
      'reason',
    ])
  })

  it('routes each level to its own sink', () => {
    const warn = vi.fn()
    const error = vi.fn()
    const logger = createWebhookLogger('sepay-webhook', { warn, error })
    logger.log({ level: 'warn', event: 'rejected', reason: 'payload_too_large' })
    logger.log({ level: 'error', event: 'failed', reason: 'rpc_error' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('never lets a throwing sink escape', () => {
    const logger = createWebhookLogger('sepay-webhook', {
      warn: () => {
        throw new Error(FAKE_CONTENT)
      },
    })
    expect(() =>
      logger.log({ level: 'warn', event: 'rejected', reason: 'rate_limited' }),
    ).not.toThrow()
  })
})

describe('redaction regression (hostile values pushed through every field)', () => {
  const hostile: unknown[] = [
    `Apikey ${FAKE_API_KEY}`,
    `Authorization: Apikey ${FAKE_API_KEY}`,
    FAKE_SIGNATURE,
    `{"accountNumber":"${FAKE_ACCOUNT}","content":"${FAKE_CONTENT}"}`,
    `${FAKE_NAME} ${FAKE_PHONE}`,
    `client ${FAKE_IP}`,
    `Unexpected token at position 14 in ${FAKE_CONTENT}`,
    `duplicate key value violates unique constraint (account=${FAKE_ACCOUNT})`,
  ]

  it('collapses free text in every field to fixed placeholders', () => {
    const { lines, logger } = capture()
    for (const value of hostile) {
      logger.log({
        level: value as WebhookLogFields['level'],
        event: value as WebhookLogFields['event'],
        reason: value as WebhookLogFields['reason'],
        sqlState: value as string,
        errorName: value as string,
      })
    }
    expect(lines).toHaveLength(hostile.length)
    for (const line of lines) {
      expectClean(line)
      expect(JSON.parse(line)).toMatchObject({
        level: 'error',
        event: 'failed',
        reason: 'unknown',
        sql_state: 'unknown',
        error_name: 'unknown',
      })
    }
  })

  it('keeps a database error message out of the log, keeping only the SQLSTATE', () => {
    // Shape of a PostgREST error: the message and details quote payload and column values.
    const dbError = {
      code: '23505',
      message: `duplicate key value violates unique constraint (account=${FAKE_ACCOUNT})`,
      details: `Key (content)=(${FAKE_CONTENT}) already exists for ${FAKE_NAME}`,
      hint: FAKE_PHONE,
    }
    const { lines, logger } = capture()
    // Same call index.ts makes for an RPC error.
    logger.log({
      level: 'error',
      event: 'failed',
      reason: dbError.code === 'P0001' ? 'rpc_rejected' : 'rpc_error',
      sqlState: toSqlState(dbError.code),
    })
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ reason: 'rpc_error', sql_state: '23505' })
    expectClean(lines[0] ?? '')
  })

  it('does not leak when authentication fails with real secrets configured', async () => {
    const { lines, logger } = capture()
    const nowMs = 1_700_000_000_000
    const auth = await authenticateWebhook(
      {
        authorization: `Apikey ${FAKE_API_KEY}-wrong`,
        signature: null,
        timestamp: null,
        rawBody: JSON.stringify({ accountNumber: FAKE_ACCOUNT, content: FAKE_CONTENT }),
      },
      { apiKey: FAKE_API_KEY, hmacSecret: FAKE_HMAC_SECRET },
      nowMs,
    )
    expect(auth.ok).toBe(false)
    if (!auth.ok) {
      logger.log({ level: 'warn', event: 'unauthorized', reason: toLogReason(auth.reason) })
    }
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'unauthorized',
      reason: 'bad_api_key',
    })
    expectClean(lines[0] ?? '')
  })
})

describe('sepay-webhook/index.ts logging discipline', () => {
  // The Edge entry point cannot be imported under Vitest (it calls Deno.serve), so guard the source:
  // a future edit that logs raw values or reads exception text should fail here.
  // scan code only: comments may legitimately mention the fields that must not be logged
  // (split on /\r?\n/: a Windows checkout with autocrlf has CRLF line ends, which would keep the comments)
  const source = indexSource
    .split(/\r?\n/)
    .map((line: string) => line.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''))
    .join('\n')

  it('writes to the console only through the sanitized logger sinks', () => {
    const calls = source.match(/console\.\w+/g) ?? []
    expect(calls.sort()).toEqual(['console.error', 'console.warn'])
    expect(source).toMatch(/warn: \(line\) => console\.warn\(line\)/)
    expect(source).toMatch(/error: \(line\) => console\.error\(line\)/)
  })

  it('never reads exception or database error text, request headers or the body for logging', () => {
    for (const forbidden of [
      /\.message\b/,
      /\.stack\b/,
      /\.details\b/,
      /\.hint\b/,
      /String\(\s*(thrown|error|err)\s*\)/,
      /JSON\.stringify\(\s*(thrown|error|payload|rawBody|request)/,
    ]) {
      expect(source, String(forbidden)).not.toMatch(forbidden)
    }
    const logCalls = source.match(/logger\.log\(\{[\s\S]*?\}\)/g) ?? []
    expect(logCalls.length).toBeGreaterThanOrEqual(8)
    for (const call of logCalls) {
      // identifiers only: stable reason strings such as 'invalid_payload' are fine
      const identifiers = call.replace(/'[^']*'/g, "''")
      expect(identifiers).not.toMatch(
        /rawBody|payload|headers|authorization|signature|apiKey|clientKey/i,
      )
    }
  })
})
