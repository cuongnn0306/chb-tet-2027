/** Inventory movement vocabulary (TECH_DESIGN §3.11) and small pure helpers for the stock screens. */
export const MOVEMENT_TYPES = [
  'PRODUCTION_IN',
  'SALE_OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'RETURN_IN',
  'DAMAGE_OUT',
  'SAMPLE_OUT',
  'GIFT_OUT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'INSPECTION_TO_AVAILABLE',
  'INSPECTION_TO_DAMAGED',
] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  PRODUCTION_IN: 'Nhập từ sản xuất',
  SALE_OUT: 'Xuất bán',
  TRANSFER_OUT: 'Xuất điều chuyển',
  TRANSFER_IN: 'Nhận điều chuyển',
  RETURN_IN: 'Nhận hàng hoàn',
  DAMAGE_OUT: 'Hỏng/hủy',
  SAMPLE_OUT: 'Xuất hàng mẫu',
  GIFT_OUT: 'Xuất hàng biếu',
  ADJUSTMENT_IN: 'Điều chỉnh tăng',
  ADJUSTMENT_OUT: 'Điều chỉnh giảm',
  INSPECTION_TO_AVAILABLE: 'Kiểm tra → nhập lại kho',
  INSPECTION_TO_DAMAGED: 'Kiểm tra → hàng hỏng',
}

export function isMovementType(value: unknown): value is MovementType {
  return typeof value === 'string' && (MOVEMENT_TYPES as readonly string[]).includes(value)
}

/** The exits warehouse staff may record by hand (INV-011); the database enforces the same list. */
export const MANUAL_EXIT_TYPES = ['SAMPLE_OUT', 'GIFT_OUT', 'DAMAGE_OUT'] as const
export type ManualExitType = (typeof MANUAL_EXIT_TYPES)[number]

/** Roles that see batch-level stock and the movement ledger's inputs (PRD: Admin/Kho/Xưởng). */
export const BATCH_VIEW_ROLES = ['ADMIN', 'WAREHOUSE', 'PRODUCTION'] as const
/** Roles that see the movement history (INV-009). */
export const LEDGER_VIEW_ROLES = ['ADMIN', 'WAREHOUSE'] as const

export type ExpiryStatus = 'EXPIRED' | 'EXPIRING_SOON' | 'OK'

/**
 * Expiry state of a batch. Both dates are calendar dates "YYYY-MM-DD" so no time zone can shift the day.
 * `alertDays` is the Admin-configured `batch_expiry_alert_days` (when unknown, pass 0: only EXPIRED/OK).
 */
export function expiryStatus(expiryDate: string, today: string, alertDays = 0): ExpiryStatus {
  if (expiryDate < today) return 'EXPIRED'
  if (alertDays > 0) {
    const limit = new Date(`${today}T00:00:00Z`)
    limit.setUTCDate(limit.getUTCDate() + alertDays)
    if (expiryDate <= limit.toISOString().slice(0, 10)) return 'EXPIRING_SOON'
  }
  return 'OK'
}

/** Sellable = usable (available - reserved, non-expired active batches) - safety stock, never below 0. */
export function sellableQuantity(usable: number, safetyStock: number): number {
  return Math.max(usable - safetyStock, 0)
}

/** Vietnam business date (UTC+7) as "YYYY-MM-DD" for an instant. */
export function businessDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
