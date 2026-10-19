import {
  returnableQuantity,
  validateReturnRequest,
  type ReturnRequestInput,
  type ReturnStatus,
  type ReturnableLine,
} from '@/domain/returns/request'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError } from './crud.service'

export interface ReturnItem {
  id: string
  return_id: string
  order_item_id: string
  product_id: string
  quantity: number
  products: { sku: string; name: string } | null
}

export interface ReturnRecord {
  id: string
  return_code: string
  order_id: string
  reason: string
  status: ReturnStatus
  created_by: string
  inspected_by: string | null
  created_at: string
  inspected_at: string | null
}

/** A return with the names the detail screen needs (Admin only, RLS). */
export interface ReturnDetail extends ReturnRecord {
  orders: { order_code: string } | null
  creator: { full_name: string } | null
  return_items: ReturnItem[]
}

/** What `request_return()` returns: the new return and its lines. */
export interface RequestedReturn extends ReturnRecord {
  items: { id: string; order_item_id: string; product_id: string; quantity: number }[]
}

/** One order line with what can still be returned, for the request form. */
export interface ReturnableOrderLine extends ReturnableLine {
  orderItemId: string
  productId: string
  sku: string
  name: string
  orderedQuantity: number
  returnable: number
}

export interface ReturnableOrder {
  orderId: string
  orderCode: string
  status: string
  lines: ReturnableOrderLine[]
}

/** Newest requests shown in a list; a screen says so when the list is cut. */
export const RETURN_LIST_LIMIT = 200

const DETAIL_SELECT = [
  'id, return_code, order_id, reason, status, created_by, inspected_by, created_at, inspected_at,',
  'orders(order_code),',
  'creator:profiles!returns_created_by_fkey(full_name),',
  'return_items(id, return_id, order_item_id, product_id, quantity, products(sku, name))',
].join(' ')

/** The error a screen shows when the input was already known to be invalid (same wording as the RPC). */
export class ReturnInputError extends Error {
  readonly code = 'P0001'
  constructor(message: string) {
    super(message)
    this.name = 'ReturnInputError'
  }
}

interface QueryResult {
  data: unknown
  error: { code?: string; message: string } | null
}

/** Minimal structural view of the query builder; keeps the deep supabase-js generics out of this file. */
interface ReturnQuery extends PromiseLike<QueryResult> {
  eq: (column: string, value: string) => ReturnQuery
  in: (column: string, values: string[]) => ReturnQuery
  order: (column: string, options: { ascending: boolean }) => ReturnQuery
  limit: (count: number) => ReturnQuery
  maybeSingle: () => PromiseLike<QueryResult>
}

interface LooseClient {
  rpc: (fn: string, args: unknown) => PromiseLike<QueryResult>
  from: (table: string) => { select: (columns: string) => ReturnQuery }
}

interface OrderLineRow {
  id: string
  product_id: string
  quantity: number
  delivered_quantity: number
  returned_quantity: number
  products: { sku: string; name: string } | null
}

interface OrderRow {
  id: string
  order_code: string
  status: string
  order_items: OrderLineRow[]
}

/**
 * RET-001: ask for delivered goods to come back and read requests. All writes go through the RPC. A request moves no
 * stock, refunds nothing, changes no commission and does not change the order (RET-002 onward).
 */
export function createReturnService(client: AppSupabaseClient) {
  const loose = client as unknown as LooseClient
  function check<T>(result: QueryResult): T {
    if (result.error) throw new DbError(result.error as never)
    return result.data as T
  }
  const rpc = async (fn: string, args: Record<string, unknown>) => check(await loose.rpc(fn, args))

  /** Order lines and what each can still return, or null when the order does not exist or is not visible. */
  async function returnableOrder(orderId: string): Promise<ReturnableOrder | null> {
    const order = check<OrderRow | null>(
      await loose
        .from('orders')
        .select(
          'id, order_code, status, order_items(id, product_id, quantity, delivered_quantity, returned_quantity, products(sku, name))',
        )
        .eq('id', orderId)
        .maybeSingle(),
    )
    if (!order) return null

    const ids = order.order_items.map((line) => line.id)
    const requested = new Map<string, number>()
    if (ids.length > 0) {
      const rows = check<{ order_item_id: string; quantity: number }[]>(
        await loose.from('return_items').select('order_item_id, quantity').in('order_item_id', ids),
      )
      for (const row of rows ?? []) {
        requested.set(row.order_item_id, (requested.get(row.order_item_id) ?? 0) + row.quantity)
      }
    }

    return {
      orderId: order.id,
      orderCode: order.order_code,
      status: order.status,
      lines: order.order_items.map((line) => {
        const counting: ReturnableLine = {
          deliveredQuantity: line.delivered_quantity,
          returnedQuantity: line.returned_quantity,
          requestedQuantity: requested.get(line.id) ?? 0,
        }
        return {
          ...counting,
          orderItemId: line.id,
          productId: line.product_id,
          sku: line.products?.sku ?? '',
          name: line.products?.name ?? '',
          orderedQuantity: line.quantity,
          returnable: returnableQuantity(counting),
        }
      }),
    }
  }

  return {
    returnableOrder,

    /**
     * Sends a request. It moves no stock, refunds nothing and leaves the order alone: the return starts as REQUESTED
     * and waits for the warehouse (RET-002).
     */
    async request(input: ReturnRequestInput): Promise<RequestedReturn> {
      const { ok } = validateReturnRequest(input)
      if (!ok)
        throw new ReturnInputError('Yêu cầu chưa hợp lệ. Vui lòng kiểm tra lại các ô báo lỗi.')
      return (await rpc('request_return', {
        p_order_id: input.orderId,
        p_items: input.lines.map((line) => ({
          order_item_id: line.orderItemId,
          quantity: line.quantity,
        })),
        p_reason: input.reason.trim(),
      })) as RequestedReturn
    },

    /** Returns of one order, newest first (Admin only: RLS gives everyone else an empty list). */
    async listForOrder(orderId: string): Promise<ReturnDetail[]> {
      return check<ReturnDetail[]>(
        await loose
          .from('returns')
          .select(DETAIL_SELECT)
          .eq('order_id', orderId)
          .order('created_at', { ascending: false })
          .limit(RETURN_LIST_LIMIT),
      )
    },

    /** One return, or null when it does not exist or the caller may not see it. */
    async get(id: string): Promise<ReturnDetail | null> {
      return check<ReturnDetail | null>(
        await loose.from('returns').select(DETAIL_SELECT).eq('id', id).maybeSingle(),
      )
    },
  }
}

export type ReturnService = ReturnType<typeof createReturnService>
