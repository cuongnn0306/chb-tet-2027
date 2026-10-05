/**
 * Pre-authentication request limits for sensitive webhooks (SEC-006). Pure Web-API code (no Deno
 * globals) so it runs in the Edge Function runtime and in unit tests.
 *
 * What this gives, and what it does not:
 *  - Body size: ENFORCED per request. The body is never buffered past `maxBodyBytes`; an oversized
 *    Content-Length is refused before any byte is read, and a streamed body is cancelled as soon as
 *    the cap is crossed. This holds no matter how many isolates run.
 *  - Rate limit: BEST EFFORT only. Counters live in this isolate's memory, so they reset on cold
 *    start and are not shared between concurrent isolates/regions. They blunt a single noisy sender
 *    but are NOT a distributed guarantee. The client key comes from proxy headers, which are only
 *    trustworthy if the platform sets them; the rightmost forwarded address is used because it is
 *    the one a trusted proxy appends. Robust enforcement needs a platform/gateway control (see
 *    docs/runbooks/SEPAY_SETUP.md); nothing here replaces it.
 *  - Limits never turn off: missing or invalid configuration falls back to the defaults.
 */

/** SePay's payload is about 1 KB; 64 KiB leaves ample room while bounding memory and CPU. */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024
/** Total body-read deadline, including senders that never finish a small body. */
export const DEFAULT_BODY_TIMEOUT_MS = 10_000
/** Requests per client key per window, counted before authentication. */
export const DEFAULT_REQUESTS_PER_WINDOW = 120
/** Failed authentications per client key per window before further requests are refused early. */
export const DEFAULT_AUTH_FAILURES_PER_WINDOW = 10
export const DEFAULT_WINDOW_MS = 60_000
/** Upper bound on tracked keys so spoofed keys cannot grow memory without limit. */
export const DEFAULT_MAX_KEYS = 1_000

const UNKNOWN_KEY = 'unknown'
const OVERFLOW_KEY = 'overflow'

export interface RequestGateConfig {
  maxBodyBytes: number
  bodyTimeoutMs: number
  requestsPerWindow: number
  authFailuresPerWindow: number
  windowMs: number
  maxKeys: number
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const text = raw?.trim() ?? ''
  if (!/^[0-9]{1,9}$/.test(text)) return fallback
  const value = Number(text)
  return value >= min && value <= max ? value : fallback
}

/**
 * Reads the optional overrides from the function environment. Anything missing, non-numeric or out
 * of range yields the default, so a typo cannot disable a limit.
 */
export function loadRequestGateConfig(
  env: (name: string) => string | undefined,
): RequestGateConfig {
  return {
    maxBodyBytes: boundedInt(
      env('SEPAY_WEBHOOK_MAX_BODY_BYTES'),
      DEFAULT_MAX_BODY_BYTES,
      1_024,
      1_048_576,
    ),
    bodyTimeoutMs: boundedInt(
      env('SEPAY_WEBHOOK_BODY_TIMEOUT_MS'),
      DEFAULT_BODY_TIMEOUT_MS,
      1_000,
      30_000,
    ),
    requestsPerWindow: boundedInt(
      env('SEPAY_WEBHOOK_RATE_LIMIT_PER_MINUTE'),
      DEFAULT_REQUESTS_PER_WINDOW,
      1,
      100_000,
    ),
    authFailuresPerWindow: boundedInt(
      env('SEPAY_WEBHOOK_AUTH_FAILURES_PER_MINUTE'),
      DEFAULT_AUTH_FAILURES_PER_WINDOW,
      1,
      10_000,
    ),
    windowMs: DEFAULT_WINDOW_MS,
    maxKeys: DEFAULT_MAX_KEYS,
  }
}

/** A forwarded address worth using as a key: IPv4/IPv6 characters only, bounded length. */
function usableAddress(value: string | null): string | null {
  const text = value?.trim() ?? ''
  return /^[0-9a-fA-F:.]{2,45}$/.test(text) ? text.toLowerCase() : null
}

/**
 * Best-effort client key. Prefers the CDN-set header, then the rightmost X-Forwarded-For entry (the
 * one a trusted proxy appends; the leftmost is client-controlled), then X-Real-IP. Anything else
 * collapses into one shared bucket, which is stricter, not looser.
 */
export function clientKeyFrom(headers: Headers): string {
  const cdn = usableAddress(headers.get('cf-connecting-ip'))
  if (cdn) return cdn
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const last = usableAddress(forwarded.split(',').pop() ?? null)
    if (last) return last
  }
  return usableAddress(headers.get('x-real-ip')) ?? UNKNOWN_KEY
}

interface WindowEntry {
  count: number
  windowStart: number
}

export interface RateDecision {
  allowed: boolean
  /** Hits in the current window, including this one. */
  count: number
  limit: number
  retryAfterSeconds: number
}

/** Fixed-window counter per key, in this isolate's memory only (see the file header). */
export class WindowedCounter {
  private readonly entries = new Map<string, WindowEntry>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys: number,
  ) {}

  private slotFor(key: string, nowMs: number): { slot: string; entry: WindowEntry | undefined } {
    let entry = this.entries.get(key)
    if (entry && nowMs - entry.windowStart >= this.windowMs) {
      this.entries.delete(key)
      entry = undefined
    }
    if (entry || this.entries.size < this.maxKeys) return { slot: key, entry }
    // table full: drop expired keys, and if it is still full share one bucket instead of growing
    for (const [k, e] of this.entries) {
      if (nowMs - e.windowStart >= this.windowMs) this.entries.delete(k)
    }
    if (this.entries.size < this.maxKeys) return { slot: key, entry: undefined }
    return { slot: OVERFLOW_KEY, entry: this.entries.get(OVERFLOW_KEY) }
  }

  private retryAfter(entry: WindowEntry, nowMs: number): number {
    return Math.max(1, Math.ceil((entry.windowStart + this.windowMs - nowMs) / 1000))
  }

  /** Counts one event for the key. */
  hit(key: string, nowMs: number): RateDecision {
    const { slot, entry: existing } = this.slotFor(key, nowMs)
    const entry = existing ?? { count: 0, windowStart: nowMs }
    entry.count += 1
    this.entries.set(slot, entry)
    return {
      allowed: entry.count <= this.limit,
      count: entry.count,
      limit: this.limit,
      retryAfterSeconds: this.retryAfter(entry, nowMs),
    }
  }

  /** True when the key has already used its allowance in the current window (does not count). */
  isExhausted(key: string, nowMs: number): RateDecision {
    const entry =
      this.entries.get(key) ??
      (this.entries.size >= this.maxKeys ? this.entries.get(OVERFLOW_KEY) : undefined)
    if (!entry || nowMs - entry.windowStart >= this.windowMs) {
      return { allowed: true, count: 0, limit: this.limit, retryAfterSeconds: 0 }
    }
    return {
      allowed: entry.count < this.limit,
      count: entry.count,
      limit: this.limit,
      retryAfterSeconds: this.retryAfter(entry, nowMs),
    }
  }
}

export type BodyReadResult =
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: 'invalid_content_length' | 'too_large' | 'read_failed' | 'read_timeout' }

/**
 * Reads the request body as UTF-8 text without ever holding more than `maxBytes`. Equivalent to
 * `request.text()` for bodies within the cap, so the HMAC still covers the exact raw body.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
  timeoutMs = DEFAULT_BODY_TIMEOUT_MS,
): Promise<BodyReadResult> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    const text = declared.trim()
    if (!/^[0-9]{1,15}$/.test(text)) return { ok: false, reason: 'invalid_content_length' }
    if (Number(text) > maxBytes) return { ok: false, reason: 'too_large' }
  }
  if (!request.body) return { ok: true, text: '', bytes: 0 }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<{ timedOut: true }>((resolve) => {
    deadlineTimer = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
  })
  // A sender-controlled cancel callback can hang too; never await cancellation.
  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }
  try {
    for (;;) {
      const next = await Promise.race([
        reader.read().then((result) => ({ ...result, timedOut: false as const })),
        deadline,
      ])
      if (next.timedOut) {
        cancel()
        return { ok: false, reason: 'read_timeout' }
      }
      const { done, value } = next
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        cancel()
        return { ok: false, reason: 'too_large' }
      }
      chunks.push(value)
    }
  } catch {
    cancel()
    return { ok: false, reason: 'read_failed' }
  } finally {
    clearTimeout(deadlineTimer)
    // Some runtimes may still have a pending read during cancellation.
    try {
      reader.releaseLock()
    } catch {
      /* cancellation already requested */
    }
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(merged), bytes: total }
}

export type Admission =
  | { ok: true; clientKey: string; rawBody: string }
  | {
      ok: false
      status: 400 | 408 | 413 | 429
      error:
        | 'invalid_content_length'
        | 'payload_too_large'
        | 'rate_limited'
        | 'read_failed'
        | 'request_timeout'
      retryAfterSeconds?: number
      /** Set only when this rejection merits a log line (first of a window), to avoid log floods. */
      logReason?: string
    }

export interface RequestGate {
  /** Rate checks first, then the bounded body read. Call before authentication. */
  admit(request: Request, nowMs?: number): Promise<Admission>
  /** Counts a failed authentication; repeated failures make `admit` refuse that key early. */
  recordAuthFailure(clientKey: string, nowMs?: number): { logReason?: string }
}

export function createRequestGate(config: RequestGateConfig): RequestGate {
  const requests = new WindowedCounter(config.requestsPerWindow, config.windowMs, config.maxKeys)
  const failures = new WindowedCounter(
    config.authFailuresPerWindow,
    config.windowMs,
    config.maxKeys,
  )

  return {
    async admit(request, nowMs = Date.now()) {
      const clientKey = clientKeyFrom(request.headers)

      const hit = requests.hit(clientKey, nowMs)
      if (!hit.allowed) {
        return {
          ok: false,
          status: 429,
          error: 'rate_limited',
          retryAfterSeconds: hit.retryAfterSeconds,
          logReason: hit.count === hit.limit + 1 ? 'rate_limited' : undefined,
        }
      }
      const failed = failures.isExhausted(clientKey, nowMs)
      if (!failed.allowed) {
        return {
          ok: false,
          status: 429,
          error: 'rate_limited',
          retryAfterSeconds: failed.retryAfterSeconds,
        }
      }

      const body = await readBodyWithLimit(request, config.maxBodyBytes, config.bodyTimeoutMs)
      if (!body.ok) {
        if (body.reason === 'read_timeout') {
          return { ok: false, status: 408, error: 'request_timeout', logReason: 'read_timeout' }
        }
        if (body.reason === 'too_large') {
          return {
            ok: false,
            status: 413,
            error: 'payload_too_large',
            logReason: 'payload_too_large',
          }
        }
        return {
          ok: false,
          status: 400,
          error:
            body.reason === 'invalid_content_length' ? 'invalid_content_length' : 'read_failed',
          logReason: body.reason,
        }
      }
      return { ok: true, clientKey, rawBody: body.text }
    },

    recordAuthFailure(clientKey, nowMs = Date.now()) {
      const hit = failures.hit(clientKey, nowMs)
      return { logReason: hit.count === hit.limit ? 'auth_failure_limit_reached' : undefined }
    },
  }
}
