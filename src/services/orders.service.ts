import type { StockLine } from '@/domain/inventory/shortage'
import type { OrderAction, OrderStatus } from '@/domain/orders/state-machine'
import type { AppSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database.generated'
import { DbError } from './crud.service'

export type Order = Database['public']['Tables']['orders']['Row']
export type OrderItem = Database['public']['Tables']['order_items']['Row']

export interface OrderLineInput {
  productId: string
  quantity: number
}

export interface QuoteLine {
  product_id: string
  quantity: number
  list_price: number
  gross_line_amount: number
  commission_rate: number
}

export interface Quote {
  gross_amount: number
  /** Largest customer discount allowed (base commission, capped at the order value). */
  max_discount_amount: number
  lines: QuoteLine[]
}

/**
 * COM-002: how a rate was found. USER_PRODUCT/USER/ROLE_PRODUCT/ROLE are commission_rules rows (COM-001
 * priority); PRODUCT_DEFAULT is the product's default rate; NONE means the product no longer exists.
 */
export type CommissionRuleSource =
  'USER_PRODUCT' | 'USER' | 'ROLE_PRODUCT' | 'ROLE' | 'PRODUCT_DEFAULT' | 'NONE'

export interface CommissionLineEstimate {
  order_item_id: string
  product_id: string
  sku: string
  quantity: number
  /** list price x quantity */
  commission_revenue: number
  rate_percent: number
  rule_source: CommissionRuleSource
  /** Rule evidence is Admin-only: null for the salesperson. */
  rule_id: string | null
  rule_effective_from: string | null
  rule_effective_to: string | null
  base_commission: number
  /** The line's share of the customer discount (used for returns). */
  customer_discount_share: number
  /** Part of the discount funded by this line's commission: 0..base. Null for legacy snapshots. */
  commission_deduction: number | null
  /** base - deduction, never negative. Null for legacy snapshots (allocation_version 1). */
  payable_commission: number | null
  /** What can be paid for the line; for legacy snapshots the stored difference. */
  final_commission: number
  allocation_version: 1 | 2
}

/** Admin exception raised when the discount is above the base commission at the first CONFIRMED. */
export interface CommissionDiscountException {
  status: 'PENDING' | 'APPROVED'
  company_borne_excess: number
  approved_at: string | null
  /** Admin-only. */
  approval_reason: string | null
}

export interface ApproveCommissionExceptionResult {
  order_id: string
  status: 'APPROVED'
  /** True when it was already approved: nothing changed and no second audit entry was written. */
  already_approved: boolean
  approved_at: string
}

/**
 * ESTIMATE: order never confirmed, figures follow today's rules and can still change.
 * SNAPSHOT: order was confirmed, figures are frozen from that moment (`is_final`).
 * MISSING_SNAPSHOT: confirmed before snapshots existed; no figures are invented from today's rules.
 */
export interface OrderCommissionEstimate {
  order_id: string
  basis: 'ESTIMATE' | 'SNAPSHOT' | 'MISSING_SNAPSHOT'
  is_final: boolean
  /** Business date the rates were resolved on (null for MISSING_SNAPSHOT). */
  resolved_on: string | null
  seller_user_id: string
  seller_role_code: string | null
  gross_amount: number
  discount_amount: number
  base_commission: number | null
  /** Part of the discount the commission pays for: min(discount, base). Null for legacy snapshots. */
  commission_funded_discount: number | null
  /** Discount the company bears when it exceeds the base commission; null for legacy / missing snapshots. */
  company_borne_excess: number | null
  /** The employee's payable commission (sum of the nonnegative line figures). */
  final_commission: number | null
  discount_within_base_commission: boolean | null
  /** Present once a snapshot recorded an exception; it locks the commission while PENDING. */
  exception: CommissionDiscountException | null
  commission_locked: boolean
  lines: CommissionLineEstimate[]
}

export interface SaveDraftInput {
  orderId: string | null
  customerId: string
  items: OrderLineInput[]
  discountAmount: number
  ownerUserId?: string | null
  creationLocationId?: string | null
  salesChannelId?: string | null
  leadSourceId?: string | null
  requiresInvoice: boolean
  notes: string
}

export interface OrderListRow {
  id: string
  order_code: string
  status: OrderStatus
  gross_amount: number
  discount_amount: number
  net_amount: number
  paid_amount: number
  remaining_amount: number
  created_at: string
  customers: {
    id: string
    customer_type: string
    name: string | null
    company_name: string | null
    phone: string | null
  } | null
  sales_channels: { name: string } | null
  owner: { full_name: string } | null
}

export interface OrderDetail extends Omit<Order, 'status'> {
  status: OrderStatus
  customers: {
    id: string
    customer_type: string
    name: string | null
    phone: string | null
    address: string | null
    company_name: string | null
    tax_code: string | null
    contact_name: string | null
    contact_title: string | null
    email: string | null
    company_address: string | null
  } | null
  locations: { code: string; name: string } | null
  sales_channels: { name: string } | null
  lead_sources: { name: string } | null
  owner: { full_name: string } | null
  creator: { full_name: string } | null
  order_items: (OrderItem & { products: { sku: string; name: string } | null })[]
}

export interface StatusHistoryEntry {
  id: string
  from_status: string | null
  to_status: string
  reason: string | null
  created_at: string
  actor: { full_name: string } | null
}

/** RES-009: what is held and what is missing for an order. */
export interface OrderStockStatus {
  order_id: string
  status: OrderStatus
  location_id: string
  reservation_expires_at: string | null
  lines: StockLine[]
}

export interface AllocationResult {
  location_id: string
  fully_allocated: boolean
  shortage_total: number
  lines: {
    order_item_id: string
    product_id: string
    quantity: number
    requested: number
    reserved_now: number
    shortage: number
  }[]
}

export const ORDER_PAGE_SIZE = 25

export interface OrderSearch {
  query?: string
  status?: OrderStatus | ''
  page?: number
}

const toItemsJson = (items: OrderLineInput[]) =>
  items.map((item) => ({ product_id: item.productId, quantity: item.quantity }))

/** Characters that are special inside PostgREST filter strings. */
const sanitizeForFilter = (text: string) => text.replace(/[%,()*\\]/g, ' ').trim()

export function createOrderService(client: AppSupabaseClient) {
  async function call<T>(
    fn: PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
  ): Promise<T> {
    const { data, error } = await fn
    if (error) throw new DbError(error as never)
    return data as T
  }

  return {
    async quote(items: OrderLineInput[], ownerUserId?: string | null): Promise<Quote> {
      return call(
        client.rpc('quote_order', {
          p_items: toItemsJson(items),
          p_owner_user_id: ownerUserId ?? undefined,
        }) as never,
      ) as Promise<Quote>
    },

    /**
     * COM-002: commission of one order for its salesperson or an Admin. A confirmed order returns the frozen
     * snapshot; before that it is an estimate from the rules effective today.
     */
    async commissionEstimate(orderId: string): Promise<OrderCommissionEstimate> {
      return call(
        client.rpc('estimate_order_commission', { p_order_id: orderId }) as never,
      ) as Promise<OrderCommissionEstimate>
    },

    /**
     * COM-002: Admin approves the exception that locks the commission of an order whose discount exceeded the base
     * commission at the first CONFIRMED. A written reason is required; the database audits it and repeats are safe.
     */
    async approveCommissionException(
      orderId: string,
      reason: string,
    ): Promise<ApproveCommissionExceptionResult> {
      return call(
        client.rpc('approve_commission_discount_exception', {
          p_order_id: orderId,
          p_reason: reason,
        }) as never,
      ) as Promise<ApproveCommissionExceptionResult>
    },

    async saveDraft(input: SaveDraftInput): Promise<Order> {
      return call(
        client.rpc('save_draft_order', {
          p_order_id: input.orderId as string,
          p_customer_id: input.customerId,
          p_items: toItemsJson(input.items),
          p_discount_amount: input.discountAmount,
          p_owner_user_id: input.ownerUserId ?? undefined,
          p_creation_location_id: input.creationLocationId ?? undefined,
          p_sales_channel_id: input.salesChannelId ?? undefined,
          p_lead_source_id: input.leadSourceId ?? undefined,
          p_requires_invoice: input.requiresInvoice,
          p_notes: input.notes,
        }) as never,
      ) as Promise<Order>
    },

    /** The only way the UI changes an order's status. The database validates the transition. */
    async transition(orderId: string, action: OrderAction, reason?: string): Promise<Order> {
      return call(
        client.rpc('transition_order', {
          p_order_id: orderId,
          p_action: action,
          p_reason: reason ?? undefined,
        }) as never,
      ) as Promise<Order>
    },

    /** RES-009: stock situation of one order (holds, shortage, where to get missing stock). */
    async stockStatus(orderId: string): Promise<OrderStockStatus> {
      return call(
        client.rpc('order_stock_status', { p_order_id: orderId }) as never,
      ) as Promise<OrderStockStatus>
    },

    /** Before saving: is there enough sellable stock at this location? Same shape per product line. */
    async checkStock(locationId: string, items: OrderLineInput[]): Promise<StockLine[]> {
      return call(
        client.rpc('check_stock', {
          p_location_id: locationId,
          p_items: toItemsJson(items),
        }) as never,
      ) as Promise<StockLine[]>
    },

    /** RES-007: physical allocation by FEFO (Admin or Warehouse). */
    async allocate(orderId: string, allowBelowSafety = false): Promise<AllocationResult> {
      return call(
        client.rpc('allocate_order', {
          p_order_id: orderId,
          p_allow_below_safety: allowBelowSafety,
        }) as never,
      ) as Promise<AllocationResult>
    },

    /** ORD-011: the signed-in user's orders (RLS limits what is visible); Admin sees all. */
    async list(params: OrderSearch = {}): Promise<OrderListRow[]> {
      const page = params.page ?? 0
      let query = client
        .from('orders')
        .select(
          'id, order_code, status, gross_amount, discount_amount, net_amount, paid_amount, remaining_amount, created_at, customers(id, customer_type, name, company_name, phone), sales_channels(name), owner:profiles!orders_owner_user_id_fkey(full_name)',
        )
        .order('created_at', { ascending: false })
        .range(page * ORDER_PAGE_SIZE, page * ORDER_PAGE_SIZE + ORDER_PAGE_SIZE) // one extra row = "has next page"

      if (params.status) query = query.eq('status', params.status)

      const text = sanitizeForFilter(params.query ?? '')
      if (text !== '') {
        // Match the order code, or any customer found by name/company/phone/tax code.
        const found = (await call(
          client.rpc('search_customers', {
            p_query: text,
            p_include_archived: true,
            p_limit: 200,
          }) as never,
        )) as { id: string }[]
        const ids = found.map((customer) => customer.id)
        const parts = [`order_code.ilike.%${text}%`]
        if (ids.length > 0) parts.push(`customer_id.in.(${ids.join(',')})`)
        query = query.or(parts.join(','))
      }
      return (await call(query as never)) as unknown as OrderListRow[]
    },

    async get(orderId: string): Promise<OrderDetail | null> {
      const { data, error } = await client
        .from('orders')
        .select(
          '*, customers(id, customer_type, name, phone, address, company_name, tax_code, contact_name, contact_title, email, company_address), locations:creation_location_id(code, name), sales_channels(name), lead_sources(name), owner:profiles!orders_owner_user_id_fkey(full_name), creator:profiles!orders_created_by_fkey(full_name), order_items(*, products(sku, name))',
        )
        .eq('id', orderId)
        .maybeSingle()
      if (error) throw new DbError(error)
      return data as unknown as OrderDetail | null
    },

    /** ORD-013: status timeline, oldest first. */
    async history(orderId: string): Promise<StatusHistoryEntry[]> {
      const { data, error } = await client
        .from('order_status_history')
        .select(
          'id, from_status, to_status, reason, created_at, actor:profiles!order_status_history_actor_user_id_fkey(full_name)',
        )
        .eq('order_id', orderId)
        .order('created_at')
      if (error) throw new DbError(error)
      return (data ?? []) as unknown as StatusHistoryEntry[]
    },
  }
}

export type OrderService = ReturnType<typeof createOrderService>
