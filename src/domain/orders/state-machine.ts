/**
 * Order state machine (TECH_DESIGN §6). The database enforces it for every caller
 * (`private.is_valid_order_transition`); this module is the UI's read-only view of the same rules.
 * Components must never set a status directly: they call the transition RPC with an action.
 */
export const ORDER_STATUSES = [
  'DRAFT',
  'WAITING_CONFIRMATION',
  'WAITING_DEPOSIT',
  'CONFIRMED',
  'RESERVED',
  'PREPARING',
  'WAITING_DELIVERY',
  'COMPLETED',
  'CANCELLED',
  'VOIDED',
  'RETURNED',
  'EXCHANGED',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Nháp',
  WAITING_CONFIRMATION: 'Chờ xác nhận',
  WAITING_DEPOSIT: 'Chờ cọc',
  CONFIRMED: 'Đã xác nhận',
  RESERVED: 'Giữ hàng',
  PREPARING: 'Chuẩn bị hàng',
  WAITING_DELIVERY: 'Chờ giao',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
  VOIDED: 'Đã vô hiệu hóa',
  RETURNED: 'Hoàn hàng',
  EXCHANGED: 'Đổi hàng',
}

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ['WAITING_CONFIRMATION', 'CANCELLED', 'VOIDED'],
  WAITING_CONFIRMATION: ['DRAFT', 'WAITING_DEPOSIT', 'CANCELLED', 'VOIDED'],
  WAITING_DEPOSIT: ['CONFIRMED', 'CANCELLED', 'VOIDED'],
  CONFIRMED: ['RESERVED', 'CANCELLED', 'VOIDED'],
  RESERVED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['WAITING_DELIVERY'],
  WAITING_DELIVERY: ['COMPLETED'],
  COMPLETED: ['RETURNED', 'EXCHANGED'],
  CANCELLED: [],
  VOIDED: [],
  RETURNED: [],
  EXCHANGED: [],
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to)
}

/** Statuses in which a customer, line, quantity or price may still be edited. */
export function isEditable(status: OrderStatus): boolean {
  return status === 'DRAFT'
}

export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'CANCELLED',
  'VOIDED',
  'RETURNED',
  'EXCHANGED',
]

/** User-initiated actions accepted by the `transition_order` RPC. */
export type OrderAction = 'submit' | 'return_to_draft' | 'confirm' | 'cancel' | 'void'

interface ActionRule {
  to: OrderStatus
  from: readonly OrderStatus[]
  adminOnly: boolean
  needsReason: boolean
  /** Statuses from which a non-admin owner may still perform it. */
  ownerFrom?: readonly OrderStatus[]
}

export const ORDER_ACTION_RULES: Record<OrderAction, ActionRule> = {
  submit: { to: 'WAITING_CONFIRMATION', from: ['DRAFT'], adminOnly: false, needsReason: false },
  return_to_draft: {
    to: 'DRAFT',
    from: ['WAITING_CONFIRMATION'],
    adminOnly: false,
    needsReason: false,
  },
  confirm: {
    to: 'WAITING_DEPOSIT',
    from: ['WAITING_CONFIRMATION'],
    adminOnly: true,
    needsReason: false,
  },
  cancel: {
    to: 'CANCELLED',
    from: ['DRAFT', 'WAITING_CONFIRMATION', 'WAITING_DEPOSIT', 'CONFIRMED', 'RESERVED'],
    adminOnly: false,
    needsReason: true,
    // After confirmation money and stock are involved, so only Admin may cancel.
    ownerFrom: ['DRAFT', 'WAITING_CONFIRMATION', 'WAITING_DEPOSIT'],
  },
  void: {
    to: 'VOIDED',
    from: ['DRAFT', 'WAITING_CONFIRMATION', 'WAITING_DEPOSIT', 'CONFIRMED'],
    adminOnly: true,
    needsReason: true,
  },
}

/** Actions the signed-in user may offer for an order (UI hint; the RPC re-checks everything). */
export function availableActions(status: OrderStatus, isAdmin: boolean): OrderAction[] {
  return (Object.keys(ORDER_ACTION_RULES) as OrderAction[]).filter((action) => {
    const rule = ORDER_ACTION_RULES[action]
    if (!rule.from.includes(status)) return false
    if (rule.adminOnly) return isAdmin
    if (isAdmin) return true
    return rule.ownerFrom ? rule.ownerFrom.includes(status) : true
  })
}
