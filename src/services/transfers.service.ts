import {
  validateTransferRequest,
  type TransferRequestInput,
  type TransferStatus,
} from '@/domain/transfers/transfers'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError } from './crud.service'

export interface TransferItem {
  id: string
  product_id: string
  requested_qty: number
  approved_qty: number
  dispatched_qty: number
  received_qty: number
  products: { sku: string; name: string } | null
}

export interface Transfer {
  id: string
  transfer_code: string
  requested_by: string
  source_location_id: string
  destination_location_id: string
  status: TransferStatus
  approved_by: string | null
  approved_at: string | null
  dispatched_at: string | null
  received_at: string | null
  reason: string
  created_at: string
}

/** A transfer with the names the queue and the detail screen need (subject to RLS). */
export interface TransferDetail extends Transfer {
  source: { code: string; name: string } | null
  destination: { code: string; name: string } | null
  requester: { full_name: string } | null
  transfer_items: TransferItem[]
}

/** What `request_transfer()` returns: the new transfer and its lines. */
export interface RequestedTransfer extends Transfer {
  items: { id: string; product_id: string; requested_qty: number }[]
}

export interface TransferFormOptions {
  locations: { value: string; label: string }[]
  products: { value: string; label: string }[]
}

/** Newest requests shown in the queue; the screen says so when the list is cut. */
export const TRANSFER_LIST_LIMIT = 200

// Batch columns are not selected on purpose: sales users never see or choose batches (AGENTS §4).
const DETAIL_SELECT = [
  'id, transfer_code, requested_by, source_location_id, destination_location_id, status,',
  'approved_by, approved_at, dispatched_at, received_at, reason, created_at,',
  'source:locations!transfers_source_location_id_fkey(code, name),',
  'destination:locations!transfers_destination_location_id_fkey(code, name),',
  'requester:profiles!transfers_requested_by_fkey(full_name),',
  'transfer_items(id, product_id, requested_qty, approved_qty, dispatched_qty, received_qty, products(sku, name))',
].join(' ')

/** The error a screen shows when the input was already known to be invalid (same wording as the RPC). */
export class TransferInputError extends Error {
  readonly code = 'P0001'
  constructor(message: string) {
    super(message)
    this.name = 'TransferInputError'
  }
}

interface QueryResult {
  data: unknown
  error: { code?: string; message: string } | null
}

/** Minimal structural view of the query builder; keeps the deep supabase-js generics out of this file. */
interface TransferQuery extends PromiseLike<QueryResult> {
  eq: (column: string, value: string) => TransferQuery
  order: (column: string, options: { ascending: boolean }) => TransferQuery
  limit: (count: number) => TransferQuery
  maybeSingle: () => PromiseLike<QueryResult>
}

interface LooseClient {
  rpc: (fn: string, args: unknown) => PromiseLike<QueryResult>
  from: (table: string) => { select: (columns: string) => TransferQuery }
}

/** TRF-001: request a stock transfer and read requests. All writes go through the RPC. */
export function createTransferService(client: AppSupabaseClient) {
  const loose = client as unknown as LooseClient
  function check<T>(result: QueryResult): T {
    if (result.error) throw new DbError(result.error as never)
    return result.data as T
  }
  const rpc = async (fn: string, args: Record<string, unknown>) => check(await loose.rpc(fn, args))

  return {
    /** Active locations and products for the request form (both readable by every active user). */
    async requestOptions(): Promise<TransferFormOptions> {
      const [locations, products] = await Promise.all([
        client.from('locations').select('id, code, name').eq('is_active', true).order('code'),
        client.from('products').select('id, sku, name').eq('is_active', true).order('sku'),
      ])
      if (locations.error) throw new DbError(locations.error)
      if (products.error) throw new DbError(products.error)
      return {
        locations: (locations.data ?? []).map((row) => ({
          value: row.id,
          label: `${row.code} — ${row.name}`,
        })),
        products: (products.data ?? []).map((row) => ({
          value: row.id,
          label: `${row.sku} — ${row.name}`,
        })),
      }
    },

    /**
     * Sends a request. It moves no stock, picks no batch and creates no revenue: the transfer starts as
     * REQUESTED and waits for the Admin (TRF-003).
     */
    async request(input: TransferRequestInput): Promise<RequestedTransfer> {
      const { ok } = validateTransferRequest(input)
      if (!ok)
        throw new TransferInputError('Yêu cầu chưa hợp lệ. Vui lòng kiểm tra lại các ô báo lỗi.')
      return (await rpc('request_transfer', {
        p_source_location_id: input.sourceLocationId,
        p_destination_location_id: input.destinationLocationId,
        p_items: input.lines.map((line) => ({
          product_id: line.productId,
          quantity: line.quantity,
        })),
        p_reason: input.reason.trim(),
      })) as RequestedTransfer
    },

    /** Queue, newest first: all requests for the Admin, the caller's own for everyone else (RLS). */
    async list(filter: { status?: TransferStatus } = {}): Promise<TransferDetail[]> {
      let query = loose.from('transfers').select(DETAIL_SELECT)
      if (filter.status) query = query.eq('status', filter.status)
      query = query.order('created_at', { ascending: false }).limit(TRANSFER_LIST_LIMIT)
      return check<TransferDetail[]>(await query)
    },

    /** One request, or null when it does not exist or the caller may not see it. */
    async get(id: string): Promise<TransferDetail | null> {
      return check<TransferDetail | null>(
        await loose.from('transfers').select(DETAIL_SELECT).eq('id', id).maybeSingle(),
      )
    },
  }
}

export type TransferService = ReturnType<typeof createTransferService>
