/** Payment vocabulary and pure helpers (PRD §18, TECH_DESIGN §3.21 / §10). Money is integer VND. */
import { parseVnd } from '@/lib/money'

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'QR', 'COD'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
  QR: 'QR (chuyển khoản tự động)',
  COD: 'Thu hộ khi giao (COD)',
}

export const PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED', 'REFUNDED', 'VOIDED'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Chờ xác nhận',
  CONFIRMED: 'Đã nhận tiền',
  FAILED: 'Thất bại',
  REFUNDED: 'Đã hoàn tiền',
  VOIDED: 'Đã hủy',
}

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value)
}

/** The four order-level payment states of PRD §18. */
export type OrderPaymentState = 'UNPAID' | 'DEPOSITED' | 'PARTIAL' | 'PAID'

export const ORDER_PAYMENT_STATE_LABELS: Record<OrderPaymentState, string> = {
  UNPAID: 'Chưa thanh toán',
  DEPOSITED: 'Đã cọc',
  PARTIAL: 'Thanh toán một phần',
  PAID: 'Đã thanh toán',
}

export function orderPaymentState(order: {
  net_amount: number
  paid_amount: number
  deposit_required: number
}): OrderPaymentState {
  if (order.paid_amount <= 0) return 'UNPAID'
  if (order.paid_amount >= order.net_amount) return 'PAID'
  if (order.deposit_required > 0 && order.paid_amount >= order.deposit_required) return 'DEPOSITED'
  return 'PARTIAL'
}

/**
 * Deposit rule (mirrors private.compute_deposit in the database, which is authoritative):
 * PERCENT rounds UP to whole VND, FIXED_AMOUNT is taken as is; never more than the order value.
 */
export function computeDeposit(
  netAmount: number,
  type: 'PERCENT' | 'FIXED_AMOUNT',
  value: number,
): number {
  const raw = type === 'PERCENT' ? Math.ceil((netAmount * Math.min(value, 100)) / 100) : value
  return Math.min(Math.max(raw, 0), netAmount)
}

export interface QrParams {
  bank: string
  accountNo: string
  amount: number
  /** What the customer writes in the transfer: the order code. */
  content: string
}

/**
 * VietQR image served by SePay (https://qr.sepay.vn): account, bank, exact amount and payment code.
 * The image host sees these public transfer details; no secret is ever put in this URL.
 */
export function buildSepayQrUrl({ bank, accountNo, amount, content }: QrParams): string {
  const params = new URLSearchParams({
    acc: accountNo,
    bank,
    amount: String(Math.max(Math.trunc(amount), 0)),
    des: content,
  })
  return `https://qr.sepay.vn/img?${params.toString()}`
}

export interface RecordPaymentInput {
  method: string
  amount: string
  /** True when the Admin has already received the money. */
  received: boolean
  /** The most that may still be paid (order remaining), when known. */
  maxAmount?: number
}

export interface RecordPaymentResult {
  errors: Record<string, string>
  amount: number | null
}

export function validateRecordPayment(input: RecordPaymentInput): RecordPaymentResult {
  const errors: Record<string, string> = {}
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method))
    errors.method = 'Vui lòng chọn phương thức.'
  const parsed = parseVnd(input.amount, { label: 'Số tiền' })
  if (parsed.error !== null) errors.amount = parsed.error
  else if (parsed.value <= 0) errors.amount = 'Số tiền phải lớn hơn 0.'
  else if (input.maxAmount !== undefined && parsed.value > input.maxAmount) {
    errors.amount = `Số tiền vượt quá số còn phải thu (${input.maxAmount.toLocaleString('vi-VN')} ₫).`
  }
  return { errors, amount: parsed.error === null && !errors.amount ? parsed.value : null }
}
