import { hasPermission, type RoleCode } from '@/domain/auth/roles'
import type { AccessState } from '@/domain/auth/access'

/** Default and hard upper bound of rows per page (server-side pagination). */
export const AUDIT_PAGE_SIZE = 50
export const AUDIT_MAX_PAGE_SIZE = 100
/** Highest page index accepted; keeps `range()` offsets small and bounded. */
export const AUDIT_MAX_PAGE = 10_000
export const AUDIT_TEXT_FILTER_MAX_LENGTH = 64

/** Vietnam has no daylight saving; calendar-day filters are interpreted at UTC+7. */
const VIETNAM_UTC_OFFSET_HOURS = 7
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** Raw filter values as typed by the user (all optional, empty = not set). */
export interface AuditFilterInput {
  entityType?: string
  action?: string
  actorUserId?: string
  entityId?: string
  /** Calendar day `YYYY-MM-DD`, inclusive. */
  dateFrom?: string
  /** Calendar day `YYYY-MM-DD`, inclusive. */
  dateTo?: string
}

/** Validated filters ready for the query: `createdFrom` inclusive, `createdBefore` exclusive (UTC ISO). */
export interface AuditFilters {
  entityType?: string
  action?: string
  actorUserId?: string
  entityId?: string
  createdFrom?: string
  createdBefore?: string
}

export type AuditFilterErrors = Partial<Record<keyof AuditFilterInput, string>>

export type AuditFilterParseResult =
  { ok: true; filters: AuditFilters } | { ok: false; errors: AuditFilterErrors }

/** Thrown by the service for input that must never reach the database. Message is Vietnamese. */
export class AuditQueryError extends Error {
  readonly errors: AuditFilterErrors
  constructor(message: string, errors: AuditFilterErrors = {}) {
    super(message)
    this.name = 'AuditQueryError'
    this.errors = errors
  }
}

// Recorded entity types / actions are identifiers (table names, lower-case operations, RPC event names).
// Restricting the charset also keeps separators of the PostgREST filter grammar out of any request.
const IDENTIFIER = /^[A-Za-z0-9_.:-]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

function trimmed(value: string | undefined): string {
  return (value ?? '').trim()
}

/** Start of the Vietnam calendar day as a UTC millisecond timestamp, or null if it is not a real date. */
function startOfVietnamDay(value: string): number | null {
  const match = DAY.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 2000 || year > 2100) return null
  const utc = Date.UTC(year, month - 1, day)
  const check = new Date(utc)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null
  }
  return utc - VIETNAM_UTC_OFFSET_HOURS * HOUR_MS
}

function parseIdentifier(
  value: string,
  label: string,
  errors: AuditFilterErrors,
  key: 'entityType' | 'action',
) {
  if (value === '') return undefined
  if (value.length > AUDIT_TEXT_FILTER_MAX_LENGTH) {
    errors[key] = `${label} tối đa ${AUDIT_TEXT_FILTER_MAX_LENGTH} ký tự.`
    return undefined
  }
  if (!IDENTIFIER.test(value)) {
    errors[key] = `${label} chỉ gồm chữ, số và các ký tự _ . : -`
    return undefined
  }
  return value
}

/** Validates and normalises the filters. Nothing invalid is ever passed on to the database. */
export function parseAuditFilters(input: AuditFilterInput): AuditFilterParseResult {
  const errors: AuditFilterErrors = {}
  const filters: AuditFilters = {}

  const entityType = parseIdentifier(
    trimmed(input.entityType),
    'Loại đối tượng',
    errors,
    'entityType',
  )
  if (entityType !== undefined) filters.entityType = entityType
  const action = parseIdentifier(trimmed(input.action), 'Hành động', errors, 'action')
  if (action !== undefined) filters.action = action

  const actor = trimmed(input.actorUserId)
  if (actor !== '') {
    if (UUID.test(actor)) filters.actorUserId = actor.toLowerCase()
    else errors.actorUserId = 'Người thực hiện không hợp lệ. Vui lòng chọn lại từ danh sách.'
  }

  const entityId = trimmed(input.entityId)
  if (entityId !== '') {
    if (UUID.test(entityId)) filters.entityId = entityId.toLowerCase()
    else errors.entityId = 'Mã bản ghi phải là một mã UUID hợp lệ.'
  }

  const from = trimmed(input.dateFrom)
  const to = trimmed(input.dateTo)
  let fromStart: number | null = null
  let toStart: number | null = null
  if (from !== '') {
    fromStart = startOfVietnamDay(from)
    if (fromStart === null) errors.dateFrom = 'Từ ngày không hợp lệ.'
  }
  if (to !== '') {
    toStart = startOfVietnamDay(to)
    if (toStart === null) errors.dateTo = 'Đến ngày không hợp lệ.'
  }
  if (fromStart !== null && toStart !== null && fromStart > toStart) {
    errors.dateTo = 'Đến ngày phải sau hoặc bằng Từ ngày.'
  }
  if (!errors.dateFrom && !errors.dateTo) {
    if (fromStart !== null) filters.createdFrom = new Date(fromStart).toISOString()
    if (toStart !== null) filters.createdBefore = new Date(toStart + DAY_MS).toISOString()
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, filters }
}

/** Page index within bounds, or an error for anything else (never silently clamped). */
export function assertAuditPage(page: number): number {
  if (!Number.isInteger(page) || page < 0 || page > AUDIT_MAX_PAGE) {
    throw new AuditQueryError('Trang không hợp lệ.')
  }
  return page
}

export function assertAuditPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > AUDIT_MAX_PAGE_SIZE) {
    throw new AuditQueryError(`Số dòng mỗi trang phải từ 1 đến ${AUDIT_MAX_PAGE_SIZE}.`)
  }
  return pageSize
}

export type AuditViewerAccess =
  { status: 'loading' } | { status: 'denied' } | { status: 'allowed'; identity: string }

/**
 * Whether the viewer may be mounted (and therefore allowed to read). Only an active user holding
 * `view_audit_log` gets an identity; the identity includes the role so a role change remounts the viewer.
 * This is a UI hint: RLS is the actual boundary.
 */
export function resolveAuditViewerAccess(access: AccessState): AuditViewerAccess {
  if (access.status === 'loading') return { status: 'loading' }
  if (access.status !== 'active') return { status: 'denied' }
  if (!hasPermission(access.user.roleCode, 'view_audit_log')) return { status: 'denied' }
  return { status: 'allowed', identity: auditIdentity(access.user.id, access.user.roleCode) }
}

export function auditIdentity(userId: string, roleCode: RoleCode): string {
  return `${userId}:${roleCode}`
}

export interface ActorLabel {
  kind: 'person' | 'system' | 'unknown'
  label: string
}

/** Never presents a missing actor as a person. */
export function describeAuditActor(
  actorUserId: string | null,
  fullName: string | null,
): ActorLabel {
  if (actorUserId === null) return { kind: 'system', label: 'Hệ thống / không có người dùng' }
  const name = fullName?.trim()
  if (name) return { kind: 'person', label: name }
  return { kind: 'unknown', label: 'Người dùng không xác định' }
}

const SECRET_KEY = /secret|token|password|passwd|api[_-]?key|hmac|authorization|signature/i
export const REDACTED_VALUE = '[đã ẩn]'
const MAX_DEPTH = 12
/** Upper bound of characters rendered for one before/after payload. */
export const AUDIT_PAYLOAD_MAX_CHARS = 20_000

/** Display-only copy of a stored JSON value with secret-looking keys masked. The stored row is untouched. */
export function redactAuditPayload(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[quá sâu]'
  if (Array.isArray(value)) return value.map((item) => redactAuditPayload(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED_VALUE : redactAuditPayload(item, depth + 1)
  }
  return out
}

export interface FormattedPayload {
  /** Pretty JSON, or `null` when the column is empty. Render as text only. */
  text: string | null
  truncated: boolean
}

export function formatAuditPayload(value: unknown): FormattedPayload {
  if (value === null || value === undefined) return { text: null, truncated: false }
  const text = JSON.stringify(redactAuditPayload(value), null, 2) ?? String(value)
  if (text.length <= AUDIT_PAYLOAD_MAX_CHARS) return { text, truncated: false }
  return { text: text.slice(0, AUDIT_PAYLOAD_MAX_CHARS), truncated: true }
}
