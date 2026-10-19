/**
 * Return vocabulary and pure rules for the request stage (TECH_DESIGN §3.24/§3.25/§11, PRD §20).
 * The database enforces every rule too: this module only gives the screens fast feedback and one place for labels.
 * RET-001 covers the REQUESTED stage only: receiving, inspection, restock/damage and money belong to RET-002 onward.
 */

/** Same values as the shared StatusBadge tones (the domain layer must not import UI). */
type BadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'muted'

export const RETURN_STATUSES = [
  'REQUESTED',
  'RECEIVED_PENDING_INSPECTION',
  'RESTOCKED',
  'DAMAGED',
  'CLOSED',
] as const
export type ReturnStatus = (typeof RETURN_STATUSES)[number]

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  REQUESTED: 'Đã yêu cầu trả',
  RECEIVED_PENDING_INSPECTION: 'Chờ kiểm tra',
  RESTOCKED: 'Đã nhập lại kho',
  DAMAGED: 'Hàng hỏng',
  CLOSED: 'Đã đóng',
}

export const RETURN_STATUS_TONES: Record<ReturnStatus, BadgeTone> = {
  REQUESTED: 'warning',
  RECEIVED_PENDING_INSPECTION: 'info',
  RESTOCKED: 'success',
  DAMAGED: 'danger',
  CLOSED: 'muted',
}

export function isReturnStatus(value: unknown): value is ReturnStatus {
  return typeof value === 'string' && (RETURN_STATUSES as readonly string[]).includes(value)
}

/** TECH_DESIGN §11 (the database guard `returns_guard` allows exactly these edges). */
export const RETURN_TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  REQUESTED: ['RECEIVED_PENDING_INSPECTION'],
  RECEIVED_PENDING_INSPECTION: ['RESTOCKED', 'DAMAGED'],
  RESTOCKED: ['CLOSED'],
  DAMAGED: ['CLOSED'],
  CLOSED: [],
}

export function canTransitionReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_TRANSITIONS[from].includes(to)
}

/** Limits shared with `public.request_return()` (keep identical). */
export const MAX_RETURN_LINES = 50
export const MAX_RETURN_REASON_LENGTH = 500
/** Nine digits: what the RPC accepts, comfortably inside a Postgres `int`. */
export const MAX_LINE_QUANTITY = 999_999_999

/**
 * Only the Admin may open a return request. PERMISSION_MATRIX has no return permission and the specs do not give one to
 * Sale/Store/Franchise/Warehouse: widening this is a product decision. The RPC and RLS decide for real.
 */
export const RETURN_REQUEST_ROLES = ['ADMIN'] as const

export function canRequestReturn(role: string): boolean {
  return (RETURN_REQUEST_ROLES as readonly string[]).includes(role)
}

/**
 * Only a completed order can be returned (TECH_DESIGN §6: COMPLETED -> RETURNED). The order is not moved to RETURNED by the
 * request: that edge is an open product decision (see the RET-001 ExecPlan).
 */
export const RETURNABLE_ORDER_STATUS = 'COMPLETED'

export function isOrderReturnable(orderStatus: string): boolean {
  return orderStatus === RETURNABLE_ORDER_STATUS
}

/** What the counting rule needs about one order line. */
export interface ReturnableLine {
  deliveredQuantity: number
  /** order_items.returned_quantity: counted by later tasks, never changed by a request. */
  returnedQuantity: number
  /** Sum of return_items.quantity over every request for the line, whatever its status. */
  requestedQuantity: number
}

/**
 * How many units can still be asked back: delivered, minus the larger of "already returned" and "already requested"
 * (every request counts: there is no rejected state, and the larger-of avoids double counting once a later task also
 * copies a request into returned_quantity). Never negative.
 */
export function returnableQuantity(line: ReturnableLine): number {
  const used = Math.max(line.returnedQuantity, line.requestedQuantity)
  return Math.max(line.deliveredQuantity - used, 0)
}

/** Whole number >= 1 typed as text, or null when it is not one (no decimals, signs, or exponent). */
export function parseReturnQuantity(raw: string): number | null {
  const text = raw.trim()
  if (!/^[0-9]{1,9}$/.test(text)) return null
  const value = Number(text)
  return value >= 1 && value <= MAX_LINE_QUANTITY ? value : null
}

export interface ReturnLineInput {
  orderItemId: string
  /** null = the quantity box is empty or not a whole number. */
  quantity: number | null
}

export interface ReturnRequestInput {
  orderId: string
  lines: ReturnLineInput[]
  reason: string
}

export interface ReturnRequestErrors {
  order?: string
  reason?: string
  /** Problem with the list as a whole (empty / too many). */
  lines?: string
  /** Problem with one line, by index. */
  line: Record<number, { item?: string; quantity?: string }>
}

/**
 * Fast client-side check; the RPC repeats every rule. `returnable` (order line id -> counting inputs) is optional: when a
 * screen knows it, the cumulative cap is checked too; without it the database is the only judge of that cap.
 */
export function validateReturnRequest(
  input: ReturnRequestInput,
  returnable?: Readonly<Record<string, ReturnableLine>>,
): { ok: boolean; errors: ReturnRequestErrors } {
  const errors: ReturnRequestErrors = { line: {} }

  if (!input.orderId) errors.order = 'Vui lòng chọn đơn hàng cần trả.'

  const reason = input.reason.trim()
  if (reason === '') errors.reason = 'Vui lòng nhập lý do trả hàng.'
  else if (reason.length > MAX_RETURN_REASON_LENGTH) {
    errors.reason = `Lý do tối đa ${MAX_RETURN_REASON_LENGTH} ký tự.`
  }

  if (input.lines.length === 0) errors.lines = 'Vui lòng chọn ít nhất một sản phẩm cần trả.'
  else if (input.lines.length > MAX_RETURN_LINES) {
    errors.lines = `Mỗi yêu cầu trả hàng có tối đa ${MAX_RETURN_LINES} sản phẩm.`
  }

  const seen = new Set<string>()
  input.lines.forEach((line, index) => {
    const problem: { item?: string; quantity?: string } = {}
    if (!line.orderItemId) problem.item = 'Vui lòng chọn sản phẩm cần trả.'
    else if (seen.has(line.orderItemId)) {
      problem.item = 'Mỗi sản phẩm chỉ được xuất hiện một lần trong yêu cầu trả hàng.'
    } else seen.add(line.orderItemId)

    if (line.quantity === null || !Number.isInteger(line.quantity) || line.quantity < 1) {
      problem.quantity = 'Số lượng trả phải là số nguyên lớn hơn 0.'
    } else if (line.quantity > MAX_LINE_QUANTITY) {
      problem.quantity = 'Số lượng quá lớn. Vui lòng kiểm tra lại.'
    } else if (returnable && !problem.item) {
      const counting = returnable[line.orderItemId]
      if (!counting) problem.item = 'Dòng sản phẩm không thuộc đơn hàng này.'
      else if (counting.deliveredQuantity === 0)
        problem.item = 'Sản phẩm này chưa được giao nên không thể trả.'
      else {
        const left = returnableQuantity(counting)
        if (line.quantity > left) {
          problem.quantity =
            left === 0
              ? 'Sản phẩm này đã được trả hoặc đã có yêu cầu trả hết số lượng đã giao.'
              : `Chỉ còn có thể trả tối đa ${left} (đã giao ${counting.deliveredQuantity}).`
        }
      }
    }
    if (problem.item || problem.quantity) errors.line[index] = problem
  })

  const ok =
    !errors.order && !errors.reason && !errors.lines && Object.keys(errors.line).length === 0
  return { ok, errors }
}
