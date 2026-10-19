import {
  AUDIT_PAGE_SIZE,
  AuditQueryError,
  assertAuditPage,
  assertAuditPageSize,
  parseAuditFilters,
  type AuditFilterInput,
} from '@/domain/audit/audit-log'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError } from './crud.service'

/** One audit entry as listed. Payload columns are fetched separately (`getDetail`) when a row is opened. */
export interface AuditLogRow {
  id: string
  created_at: string
  actor_user_id: string | null
  entity_type: string
  entity_id: string | null
  action: string
  reason: string | null
  actor: { full_name: string } | null
}

export interface AuditLogDetail {
  id: string
  before_data: unknown
  after_data: unknown
}

export interface AuditLogPage {
  /** At most `pageSize` rows, newest first. */
  rows: AuditLogRow[]
  hasNext: boolean
}

export interface ListAuditLogsParams {
  filters?: AuditFilterInput
  /** Zero-based. */
  page?: number
  pageSize?: number
}

interface QueryResult<T> {
  data: T | null
  error: { code?: string; message: string } | null
}

const LIST_COLUMNS =
  'id, created_at, actor_user_id, entity_type, entity_id, action, reason, actor:profiles!audit_logs_actor_user_id_fkey(full_name)'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * SEC-001: read-only access to `audit_logs` (Admin only through RLS). The service has no write method;
 * the table is immutable in the database as well. Input is validated here, before any request is made.
 */
export function createAuditService(client: AppSupabaseClient) {
  function check<T>(result: QueryResult<T>): T {
    if (result.error) throw new DbError(result.error as never)
    return result.data as T
  }

  return {
    /** Newest first with `id` as the tie-breaker, so equal timestamps page without gaps or repeats. */
    async listLogs(
      params: ListAuditLogsParams = {},
      options: { signal?: AbortSignal } = {},
    ): Promise<AuditLogPage> {
      const parsed = parseAuditFilters(params.filters ?? {})
      if (!parsed.ok) {
        throw new AuditQueryError('Bộ lọc không hợp lệ. Vui lòng kiểm tra lại.', parsed.errors)
      }
      const page = assertAuditPage(params.page ?? 0)
      const pageSize = assertAuditPageSize(params.pageSize ?? AUDIT_PAGE_SIZE)
      const { filters } = parsed

      let query = client.from('audit_logs').select(LIST_COLUMNS)
      if (filters.entityType) query = query.eq('entity_type', filters.entityType)
      if (filters.action) query = query.eq('action', filters.action)
      if (filters.actorUserId) query = query.eq('actor_user_id', filters.actorUserId)
      if (filters.entityId) query = query.eq('entity_id', filters.entityId)
      if (filters.createdFrom) query = query.gte('created_at', filters.createdFrom)
      if (filters.createdBefore) query = query.lt('created_at', filters.createdBefore)

      const from = page * pageSize
      let ordered = query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        // One extra row tells whether a next page exists without a count query.
        .range(from, from + pageSize)
      if (options.signal) ordered = ordered.abortSignal(options.signal)

      const rows = check((await ordered) as unknown as QueryResult<AuditLogRow[]>) ?? []
      return { rows: rows.slice(0, pageSize), hasNext: rows.length > pageSize }
    },

    /** Before/after payloads of one entry, or `null` when it does not exist or is not readable. */
    async getDetail(
      id: string,
      options: { signal?: AbortSignal } = {},
    ): Promise<AuditLogDetail | null> {
      if (!UUID.test(id)) throw new AuditQueryError('Mã dòng nhật ký không hợp lệ.')
      let query = client
        .from('audit_logs')
        .select('id, before_data, after_data')
        .eq('id', id.toLowerCase())
      if (options.signal) query = query.abortSignal(options.signal)
      return check((await query.maybeSingle()) as unknown as QueryResult<AuditLogDetail | null>)
    },
  }
}

export type AuditService = ReturnType<typeof createAuditService>
