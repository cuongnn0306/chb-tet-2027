/** Delivery vocabulary and pure rules (PRD §16/17, TECH_DESIGN §3.19/§7). The database enforces them too. */
/** Same values as the shared StatusBadge tones (the domain layer must not import UI). */
type BadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'muted'

export const DELIVERY_STATUSES = [
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED',
  'CANCELLED',
] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  PREPARING: 'Đang chuẩn bị',
  READY: 'Sẵn sàng giao',
  OUT_FOR_DELIVERY: 'Đang đi giao',
  DELIVERED: 'Đã giao',
  FAILED: 'Giao thất bại',
  CANCELLED: 'Đã hủy',
}

export const DELIVERY_STATUS_TONES: Record<DeliveryStatus, BadgeTone> = {
  PREPARING: 'neutral',
  READY: 'info',
  OUT_FOR_DELIVERY: 'warning',
  DELIVERED: 'success',
  FAILED: 'danger',
  CANCELLED: 'muted',
}

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === 'string' && (DELIVERY_STATUSES as readonly string[]).includes(value)
}

export const DELIVERY_METHODS = ['CHB_DELIVERY', 'THIRD_PARTY', 'CUSTOMER_PICKUP'] as const
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number]

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  CHB_DELIVERY: 'CHB tự giao',
  THIRD_PARTY: 'Đơn vị vận chuyển',
  CUSTOMER_PICKUP: 'Khách tự đến lấy',
}

export const SHIPPING_PAYERS = ['CUSTOMER', 'COMPANY'] as const
export type ShippingPayer = (typeof SHIPPING_PAYERS)[number]
export const SHIPPING_PAYER_LABELS: Record<ShippingPayer, string> = {
  CUSTOMER: 'Khách trả',
  COMPANY: 'Công ty trả',
}

export type DeliveryAction = 'ready' | 'dispatch' | 'deliver' | 'fail' | 'cancel'

export const DELIVERY_ACTION_LABELS: Record<DeliveryAction, string> = {
  ready: 'Đã chuẩn bị xong',
  dispatch: 'Xuất kho đi giao',
  deliver: 'Xác nhận đã giao',
  fail: 'Ghi nhận giao thất bại',
  cancel: 'Hủy đợt giao',
}

/** Consequence shown before the action (no generic "are you sure"). */
export const DELIVERY_ACTION_CONSEQUENCES: Record<DeliveryAction, string> = {
  ready: 'Đợt giao chuyển sang "Sẵn sàng giao" và được đưa vào lịch giao của kho.',
  dispatch:
    'Hàng rời kho để đi giao. Hệ thống kiểm tra đã phân bổ đủ hàng tại kho xuất. Tồn kho chỉ trừ khi xác nhận đã giao.',
  deliver:
    'Hàng đã phân bổ được trừ khỏi tồn kho (xuất bán, lô gần hết hạn trước) và ghi vào lịch sử kho. Nếu đơn đã giao đủ và thanh toán đủ, đơn tự động hoàn tất.',
  fail: 'Hàng vẫn được giữ cho đơn. Bạn có thể đổi lịch giao lại sau. Lý do được lưu Audit Log.',
  cancel:
    'Số lượng của đợt giao này được trả lại để lập đợt giao khác. Hàng đã phân bổ vẫn được giữ cho đơn. Lý do được lưu Audit Log.',
}

export const DELIVERY_ACTION_NEEDS_REASON: Record<DeliveryAction, boolean> = {
  ready: false,
  dispatch: false,
  deliver: false,
  fail: true,
  cancel: true,
}

export interface DeliveryActor {
  /** Admin or Warehouse run the physical flow. */
  isWarehouseStaff: boolean
  /** Admin, or the salesperson who owns the order. */
  isPlanner: boolean
}

/** Actions a user can attempt on a delivery in `status` (the RPC re-checks everything). */
export function availableDeliveryActions(
  status: DeliveryStatus,
  actor: DeliveryActor,
): DeliveryAction[] {
  const actions: DeliveryAction[] = []
  if (actor.isWarehouseStaff) {
    if (status === 'PREPARING') actions.push('ready')
    if (status === 'READY') actions.push('dispatch')
    if (status === 'OUT_FOR_DELIVERY') actions.push('deliver', 'fail')
  }
  if (actor.isPlanner && (status === 'PREPARING' || status === 'READY')) actions.push('cancel')
  return actions
}

/** A FAILED (or still open) delivery can be moved to another day by Admin/Warehouse. */
export function canReschedule(status: DeliveryStatus, isWarehouseStaff: boolean): boolean {
  return isWarehouseStaff && (status === 'FAILED' || status === 'PREPARING' || status === 'READY')
}

/** Only a delivery that has not left the warehouse can still be edited. */
export function isDeliveryEditable(status: DeliveryStatus): boolean {
  return status === 'PREPARING'
}

const CLOSED_ORDER_STATUSES = ['COMPLETED', 'CANCELLED', 'VOIDED', 'RETURNED', 'EXCHANGED']

/** Order statuses in which a new delivery can still be planned. */
export function canPlanDelivery(orderStatus: string): boolean {
  return !CLOSED_ORDER_STATUSES.includes(orderStatus)
}

/** Quantity of an order line that is not yet assigned to any active delivery. */
export function unassignedQuantity(ordered: number, assigned: number): number {
  return Math.max(ordered - assigned, 0)
}

export interface PlanInput {
  scheduledDate: string
  today: string
  method: DeliveryMethod
  address: string
  lines: { quantity: number; max: number; name: string }[]
}

/** Client-side validation for the delivery form; returns Vietnamese messages keyed by field. */
export function validateDeliveryPlan(input: PlanInput): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) errors.scheduledDate = 'Chọn ngày giao.'
  else if (input.scheduledDate < input.today)
    errors.scheduledDate = 'Ngày giao phải từ hôm nay trở đi.'
  if (input.method !== 'CUSTOMER_PICKUP' && input.address.trim() === '') {
    errors.address = 'Nhập địa chỉ giao hàng (khách tự đến lấy thì không cần).'
  }
  if (input.lines.every((l) => !(l.quantity > 0))) {
    errors.lines = 'Chọn ít nhất một sản phẩm và số lượng giao.'
  }
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      errors.lines = `Số lượng của ${line.name} phải là số nguyên không âm.`
    } else if (line.quantity > line.max) {
      errors.lines = `${line.name}: chỉ còn có thể giao thêm ${line.max}.`
    }
  }
  return errors
}

// ---- Dates (Vietnam business day) ---------------------------------------------------------------

/** The calendar date in Vietnam as YYYY-MM-DD, for any clock instant. */
export function vietnamToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Adds whole days to a YYYY-MM-DD date without any time-zone shift. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export const BOARD_RANGES = ['today', 'tomorrow', 'week', 'month'] as const
export type BoardRange = (typeof BOARD_RANGES)[number]

export const BOARD_RANGE_LABELS: Record<BoardRange, string> = {
  today: 'Hôm nay',
  tomorrow: 'Ngày mai',
  week: '7 ngày tới',
  month: 'Lịch tháng',
}

export function boardRange(range: BoardRange, today: string): { from: string; to: string } {
  switch (range) {
    case 'today':
      return { from: today, to: today }
    case 'tomorrow':
      return { from: addDays(today, 1), to: addDays(today, 1) }
    case 'week':
      return { from: today, to: addDays(today, 6) }
    case 'month':
      return { from: today, to: addDays(today, 30) }
  }
}

/** Groups schedule rows by day, days ascending. */
export function groupByDate<T extends { scheduled_date: string }>(rows: T[]): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const list = map.get(row.scheduled_date) ?? []
    list.push(row)
    map.set(row.scheduled_date, list)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
}
