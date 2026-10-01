import type {
  DeliveryAction,
  DeliveryMethod,
  DeliveryStatus,
  ShippingPayer,
} from '@/domain/deliveries/deliveries'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError } from './crud.service'

export interface DeliveryItem {
  id: string
  order_item_id: string
  product_id: string
  quantity: number
  products: { sku: string; name: string } | null
}

export interface Delivery {
  id: string
  delivery_code: string
  order_id: string
  scheduled_date: string
  scheduled_time: string | null
  recipient_name: string
  recipient_phone: string
  delivery_address: string | null
  source_location_id: string
  delivery_method: DeliveryMethod
  shipping_fee: number
  shipping_fee_payer: ShippingPayer
  status: DeliveryStatus
  notes: string | null
  delivered_at: string | null
  failed_reason: string | null
  cancelled_reason: string | null
  created_at: string
}

export interface OrderDelivery extends Delivery {
  delivery_items: DeliveryItem[]
  locations: { code: string; name: string } | null
}

export interface ScheduleRow {
  delivery_id: string
  delivery_code: string
  order_id: string
  order_code: string
  order_status: string
  scheduled_date: string
  scheduled_time: string | null
  status: DeliveryStatus
  recipient_name: string
  recipient_phone: string
  delivery_address: string | null
  delivery_method: DeliveryMethod
  source_location_id: string
  source_location_code: string
  owner_name: string
  customer_name: string
  lines: { sku: string; name: string; quantity: number }[] | null
  total_quantity: number
  remaining_amount: number
  shipping_fee: number
  shipping_fee_payer: ShippingPayer
  stock_risk: boolean
}

export interface DeliveryPlanInput {
  deliveryId: string | null
  orderId: string
  scheduledDate: string
  scheduledTime: string | null
  items: { order_item_id: string; quantity: number }[]
  recipientName: string
  recipientPhone: string
  address: string
  sourceLocationId: string
  method: DeliveryMethod
  shippingFee: number
  shippingFeePayer: ShippingPayer
  notes: string
}

export interface DeliveryDetail {
  delivery: Delivery
  order: {
    id: string
    order_code: string
    status: string
    net_amount: number
    paid_amount: number
    remaining_amount: number
    notes: string | null
    requires_invoice: boolean
    owner_name: string | null
  }
  source_location: { code: string; name: string; address: string | null } | null
  items: {
    order_item_id: string
    sku: string
    name: string
    quantity: number
    pick: { batch_code: string; expiry_date: string; quantity: number }[]
  }[]
}

export function createDeliveryService(client: AppSupabaseClient) {
  function check<T>(result: {
    data: T | null
    error: { code?: string; message: string } | null
  }): T {
    if (result.error) throw new DbError(result.error as never)
    return result.data as T
  }
  const rpc = async (fn: string, args: Record<string, unknown>) =>
    check(
      (await (
        client as unknown as {
          rpc: (
            f: string,
            a: unknown,
          ) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>
        }
      ).rpc(fn, args)) as never,
    )

  return {
    /** Deliveries of one order, oldest first (DEL-002: an order can have several). */
    async listForOrder(orderId: string): Promise<OrderDelivery[]> {
      const result = await client
        .from('deliveries')
        .select(
          '*, delivery_items(id, order_item_id, product_id, quantity, products(sku, name)), locations:source_location_id(code, name)',
        )
        .eq('order_id', orderId)
        .order('created_at')
      return check(result as never) as OrderDelivery[]
    },

    /** Active locations a delivery can leave from. */
    async sourceLocations(): Promise<{ id: string; code: string; name: string }[]> {
      const result = await client
        .from('locations')
        .select('id, code, name')
        .eq('is_active', true)
        .order('code')
      return check(result as never) as { id: string; code: string; name: string }[]
    },

    /** DEL-004/005: create a delivery, or replace the plan of one that is still PREPARING. */
    async save(input: DeliveryPlanInput): Promise<Delivery> {
      return (await rpc('save_delivery', {
        p_delivery_id: input.deliveryId,
        p_order_id: input.orderId,
        p_scheduled_date: input.scheduledDate,
        p_items: input.items,
        p_scheduled_time: input.scheduledTime || null,
        p_recipient_name: input.recipientName || null,
        p_recipient_phone: input.recipientPhone || null,
        p_delivery_address: input.address || null,
        p_source_location_id: input.sourceLocationId,
        p_delivery_method: input.method,
        p_shipping_fee: input.shippingFee,
        p_shipping_fee_payer: input.shippingFeePayer,
        p_notes: input.notes || null,
      })) as Delivery
    },

    async transition(
      deliveryId: string,
      action: DeliveryAction,
      reason?: string,
    ): Promise<Delivery> {
      return (await rpc('transition_delivery', {
        p_delivery_id: deliveryId,
        p_action: action,
        p_reason: reason ?? null,
      })) as Delivery
    },

    /** DEL-013: new date for a failed (or not yet dispatched) delivery. */
    async reschedule(
      deliveryId: string,
      date: string,
      time: string | null,
      reason?: string,
    ): Promise<Delivery> {
      return (await rpc('reschedule_delivery', {
        p_delivery_id: deliveryId,
        p_scheduled_date: date,
        p_scheduled_time: time || null,
        p_reason: reason ?? null,
      })) as Delivery
    },

    /** DEL-007..010: the delivery board. */
    async schedule(from: string, to: string, statuses?: DeliveryStatus[]): Promise<ScheduleRow[]> {
      return ((await rpc('delivery_schedule', {
        p_from: from,
        p_to: to,
        p_statuses: statuses ?? null,
      })) ?? []) as ScheduleRow[]
    },

    /** DEL-014/015: data for the delivery note and the warehouse issue note. */
    async detail(deliveryId: string): Promise<DeliveryDetail> {
      return (await rpc('delivery_detail', { p_delivery_id: deliveryId })) as DeliveryDetail
    },
  }
}

export type DeliveryService = ReturnType<typeof createDeliveryService>
