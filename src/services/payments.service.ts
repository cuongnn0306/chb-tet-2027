import type { PaymentMethod, PaymentStatus } from '@/domain/payments/payments'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError } from './crud.service'

export interface Payment {
  id: string
  order_id: string
  payment_code: string
  method: PaymentMethod
  amount: number
  status: PaymentStatus
  provider: string | null
  provider_reference: string | null
  transfer_content: string | null
  note: string | null
  status_reason: string | null
  paid_at: string | null
  created_at: string
}

export interface PaymentInstructions {
  order_code: string
  transfer_content: string
  status: string
  net_amount: number
  deposit_required: number
  paid_amount: number
  remaining_amount: number
  /** What the customer should transfer right now (deposit while waiting for it, else the rest). */
  amount_due: number
  reservation_expires_at: string | null
  configured: boolean
  bank: string | null
  account_no: string | null
  account_name: string | null
}

export interface PaymentEvent {
  id: string
  provider: string
  provider_event_id: string
  outcome: 'RECEIVED' | 'CREDITED' | 'DUPLICATE' | 'UNMATCHED' | 'NEEDS_REVIEW' | 'IGNORED'
  note: string | null
  received_at: string
  order_id: string | null
  payment_id: string | null
  payload: {
    transferAmount?: number
    content?: string
    description?: string
    code?: string | null
    gateway?: string
    referenceCode?: string
    transactionDate?: string
  }
}

export interface PendingPayment extends Payment {
  orders: { order_code: string } | null
}

export function createPaymentService(client: AppSupabaseClient) {
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
    /** PAY-005: amount to pay, payment code and bank details for the QR. */
    async instructions(orderId: string): Promise<PaymentInstructions> {
      return (await rpc('payment_instructions', { p_order_id: orderId })) as PaymentInstructions
    },

    /** Payment timeline of an order, oldest first. */
    async list(orderId: string): Promise<Payment[]> {
      const result = await client
        .from('payments')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at')
      return check(result as never) as Payment[]
    },

    /** PAY-002 (Admin). `received: false` records an expected payment (e.g. COD) as PENDING. */
    async record(input: {
      orderId: string
      method: PaymentMethod
      amount: number
      received: boolean
      note?: string
    }): Promise<Payment> {
      return (await rpc('record_payment', {
        p_order_id: input.orderId,
        p_method: input.method,
        p_amount: input.amount,
        p_note: input.note ?? null,
        p_confirm: input.received,
      })) as Payment
    },

    async confirm(paymentId: string): Promise<Payment> {
      return (await rpc('confirm_payment', { p_payment_id: paymentId })) as Payment
    },
    async fail(paymentId: string, reason: string): Promise<Payment> {
      return (await rpc('fail_payment', { p_payment_id: paymentId, p_reason: reason })) as Payment
    },
    async void(paymentId: string, reason: string): Promise<Payment> {
      return (await rpc('void_payment', { p_payment_id: paymentId, p_reason: reason })) as Payment
    },
    /** PAY-010 (Admin): refund a received payment. */
    async refund(paymentId: string, reason: string): Promise<Payment> {
      return (await rpc('refund_payment', { p_payment_id: paymentId, p_reason: reason })) as Payment
    },

    /** Admin review queue: transfers that could not be credited automatically. */
    async listEventsNeedingAttention(): Promise<PaymentEvent[]> {
      const result = await client
        .from('payment_events')
        .select(
          'id, provider, provider_event_id, outcome, note, received_at, order_id, payment_id, payload',
        )
        .in('outcome', ['UNMATCHED', 'NEEDS_REVIEW'])
        .is('resolved_at', null)
        .order('received_at', { ascending: false })
      return check(result as never) as PaymentEvent[]
    },

    /** Admin: payments waiting to be confirmed (e.g. COD or transfers held for review). */
    async listPending(): Promise<PendingPayment[]> {
      const result = await client
        .from('payments')
        .select('*, orders(order_code)')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
      return check(result as never) as PendingPayment[]
    },

    async assignEvent(eventId: string, orderId: string): Promise<Payment> {
      return (await rpc('assign_payment_event', {
        p_event_id: eventId,
        p_order_id: orderId,
      })) as Payment
    },
    async dismissEvent(eventId: string, note: string): Promise<void> {
      await rpc('dismiss_payment_event', { p_event_id: eventId, p_note: note })
    },

    async findOrderIdByCode(orderCode: string): Promise<string | null> {
      const result = await client
        .from('orders')
        .select('id')
        .eq('order_code', orderCode.trim().toUpperCase())
        .maybeSingle()
      return (check(result as never) as { id: string } | null)?.id ?? null
    },
  }
}

export type PaymentService = ReturnType<typeof createPaymentService>
