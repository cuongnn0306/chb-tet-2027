/**
 * Sanitized error logging for sensitive webhook paths (SEC-009). Pure Web-API code (no Deno globals)
 * so it runs in the Edge Function runtime and in unit tests.
 *
 * Rule: a log line is built ONLY from values this file controls. Callers pass an event name from a
 * closed list, a reason from a closed list and, optionally, a database SQLSTATE; anything that does
 * not match is replaced by a fixed placeholder. Free text from the request or from an exception is
 * never accepted, so there is nothing to scrub: exception messages (a JSON SyntaxError quotes part
 * of the body, a database error can quote column values), payload fields, headers, keys, client
 * addresses and URLs cannot reach the log by construction.
 *
 * Each request gets one random correlation id (not derived from anything in the request), repeated
 * on every line of that request so the lines can be joined. Nothing here sets up monitoring or
 * alerting: it only shapes what the function writes to the platform log.
 */

export const WEBHOOK_LOG_LEVELS = ['warn', 'error'] as const
export type WebhookLogLevel = (typeof WEBHOOK_LOG_LEVELS)[number]

/** What happened, by stage of the request. */
export const WEBHOOK_LOG_EVENTS = ['rejected', 'unauthorized', 'bad_request', 'failed'] as const
export type WebhookLogEvent = (typeof WEBHOOK_LOG_EVENTS)[number]

/**
 * Stable reasons. Dashboards and alerts may key on these strings, so renaming one is a breaking
 * change: add a new value instead. They include the reasons produced by request-limits.ts and
 * webhook-auth.ts.
 */
export const WEBHOOK_LOG_REASONS = [
  // request-limits.ts
  'rate_limited',
  'auth_failure_limit_reached',
  'payload_too_large',
  'invalid_content_length',
  'read_failed',
  'read_timeout',
  // webhook-auth.ts
  'no_secret_configured',
  'missing_signature',
  'bad_api_key',
  'missing_timestamp',
  'bad_timestamp',
  'stale_timestamp',
  'bad_signature',
  // payload and processing (index.ts)
  'invalid_json',
  'invalid_payload',
  'invalid_id',
  'rpc_error',
  'rpc_rejected',
  'unexpected_exception',
  // anything not in this list
  'unknown',
] as const
export type WebhookLogReason = (typeof WEBHOOK_LOG_REASONS)[number]

const REASONS: ReadonlySet<string> = new Set(WEBHOOK_LOG_REASONS)
const EVENTS: ReadonlySet<string> = new Set(WEBHOOK_LOG_EVENTS)
const LEVELS: ReadonlySet<string> = new Set(WEBHOOK_LOG_LEVELS)

/** Maps an arbitrary string to a known reason; unknown or non-string input becomes 'unknown'. */
export function toLogReason(value: unknown): WebhookLogReason {
  return typeof value === 'string' && REASONS.has(value) ? (value as WebhookLogReason) : 'unknown'
}

/** A PostgreSQL SQLSTATE is exactly five upper-case letters/digits (for example P0001, 23505). */
const SQLSTATE = /^[0-9A-Z]{5}$/

/** Keeps a database error code only when it has the SQLSTATE shape; otherwise 'unknown'. */
export function toSqlState(value: unknown): string {
  return typeof value === 'string' && SQLSTATE.test(value) ? value : 'unknown'
}

/**
 * Error class name for a caught exception, restricted to the standard JavaScript error classes.
 * The name is useful ("TypeError" vs "AbortError") while the message, which may quote request or
 * database content, is never read.
 */
const ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'AbortError',
  'TimeoutError',
])
export function toErrorName(value: unknown): string {
  if (!(value instanceof Error)) return 'unknown'
  return ERROR_NAMES.has(value.name) ? value.name : 'unknown'
}

/** Random per-request id: 128 random bits as hex, unrelated to any request content. */
export function newCorrelationId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface WebhookLogFields {
  level: WebhookLogLevel
  event: WebhookLogEvent
  reason: WebhookLogReason
  /** Database SQLSTATE, only for processing failures. */
  sqlState?: string
  /** Exception class name, only for unexpected exceptions. */
  errorName?: string
}

export type LogSink = (line: string) => void

export interface WebhookLogger {
  readonly correlationId: string
  log(fields: WebhookLogFields): void
}

/**
 * Builds the single-line JSON for one event. Every value is re-validated here, so a caller that
 * bypasses the types (a cast, or a value from JS) still cannot put free text in the line.
 */
export function formatWebhookLog(
  functionName: string,
  correlationId: string,
  fields: WebhookLogFields,
): string {
  const record: Record<string, string> = {
    fn: functionName,
    level: LEVELS.has(fields.level) ? fields.level : 'error',
    event: EVENTS.has(fields.event) ? fields.event : 'failed',
    reason: toLogReason(fields.reason),
    cid: /^[0-9a-f]{32}$/.test(correlationId) ? correlationId : 'invalid',
  }
  if (fields.sqlState !== undefined) record.sql_state = toSqlState(fields.sqlState)
  if (fields.errorName !== undefined) {
    record.error_name = ERROR_NAMES.has(fields.errorName) ? fields.errorName : 'unknown'
  }
  return JSON.stringify(record)
}

/**
 * One logger per request. `sinks` receive the formatted line; the defaults write to the console at
 * the matching level. A sink that throws must never change the HTTP response, so failures are
 * swallowed.
 */
export function createWebhookLogger(
  functionName: string,
  sinks: Partial<Record<WebhookLogLevel, LogSink>>,
  correlationId: string = newCorrelationId(),
): WebhookLogger {
  return {
    correlationId,
    log(fields) {
      const level = LEVELS.has(fields.level) ? fields.level : 'error'
      const sink = sinks[level]
      if (!sink) return
      try {
        sink(formatWebhookLog(functionName, correlationId, fields))
      } catch {
        /* logging must not affect the response */
      }
    },
  }
}
