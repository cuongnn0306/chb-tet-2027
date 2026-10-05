/**
 * Transfer vocabulary and pure rules (TECH_DESIGN §3.15/§3.16/§8, PRD §B16). The database enforces them too:
 * this module only gives the screens fast feedback and one place for labels. TRF-001 covers the request stage only.
 */
import { hasPermission, type RoleCode } from '@/domain/auth/roles'

/** Same values as the shared StatusBadge tones (the domain layer must not import UI). */
type BadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'muted'

export const TRANSFER_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'DISPATCHED',
  'RECEIVED',
  'CANCELLED',
] as const
export type TransferStatus = (typeof TRANSFER_STATUSES)[number]

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  REQUESTED: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối',
  DISPATCHED: 'Đang vận chuyển',
  RECEIVED: 'Đã nhận hàng',
  CANCELLED: 'Đã hủy',
}

export const TRANSFER_STATUS_TONES: Record<TransferStatus, BadgeTone> = {
  REQUESTED: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  DISPATCHED: 'info',
  RECEIVED: 'success',
  CANCELLED: 'muted',
}

export function isTransferStatus(value: unknown): value is TransferStatus {
  return typeof value === 'string' && (TRANSFER_STATUSES as readonly string[]).includes(value)
}

/** TECH_DESIGN §8 (the database guard `transfers_guard` allows exactly these edges). */
export const TRANSFER_TRANSITIONS: Record<TransferStatus, readonly TransferStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['DISPATCHED', 'CANCELLED'],
  REJECTED: [],
  DISPATCHED: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
}

export function canTransitionTransfer(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSFER_TRANSITIONS[from].includes(to)
}

/** Limits shared with `public.request_transfer()` (keep identical). */
export const MAX_TRANSFER_LINES = 50
export const MAX_TRANSFER_REASON_LENGTH = 500
/** Nine digits: what the RPC accepts, comfortably inside a Postgres `int`. */
export const MAX_LINE_QUANTITY = 999_999_999

/** `propose_transfer` (TECH_DESIGN §2). The RPC and RLS decide for real. */
export function canProposeTransfer(role: RoleCode): boolean {
  return hasPermission(role, 'propose_transfer')
}

/** Whole number >= 1 typed as text, or null when it is not one (no decimals, signs, or exponent). */
export function parseTransferQuantity(raw: string): number | null {
  const text = raw.trim()
  if (!/^[0-9]{1,9}$/.test(text)) return null
  const value = Number(text)
  return value >= 1 && value <= MAX_LINE_QUANTITY ? value : null
}

export interface TransferLineInput {
  productId: string
  /** null = the quantity box is empty or not a whole number. */
  quantity: number | null
}

export interface TransferRequestInput {
  sourceLocationId: string
  destinationLocationId: string
  lines: TransferLineInput[]
  reason: string
}

export interface TransferRequestErrors {
  source?: string
  destination?: string
  reason?: string
  /** Problem with the list as a whole (empty / too many). */
  lines?: string
  /** Problem with one line, by index. */
  line: Record<number, { product?: string; quantity?: string }>
}

/** Fast client-side check; the RPC repeats every rule. */
export function validateTransferRequest(input: TransferRequestInput): {
  ok: boolean
  errors: TransferRequestErrors
} {
  const errors: TransferRequestErrors = { line: {} }

  if (!input.sourceLocationId) errors.source = 'Vui lòng chọn kho xuất.'
  if (!input.destinationLocationId) errors.destination = 'Vui lòng chọn kho nhận.'
  if (
    input.sourceLocationId &&
    input.destinationLocationId &&
    input.sourceLocationId === input.destinationLocationId
  ) {
    errors.destination = 'Kho xuất và kho nhận phải khác nhau.'
  }

  const reason = input.reason.trim()
  if (reason === '') errors.reason = 'Vui lòng nhập lý do hoặc ghi chú.'
  else if (reason.length > MAX_TRANSFER_REASON_LENGTH) {
    errors.reason = `Lý do tối đa ${MAX_TRANSFER_REASON_LENGTH} ký tự.`
  }

  if (input.lines.length === 0) errors.lines = 'Vui lòng chọn ít nhất một sản phẩm cần chuyển.'
  else if (input.lines.length > MAX_TRANSFER_LINES) {
    errors.lines = `Mỗi yêu cầu có tối đa ${MAX_TRANSFER_LINES} sản phẩm.`
  }

  const seen = new Set<string>()
  input.lines.forEach((line, index) => {
    const problem: { product?: string; quantity?: string } = {}
    if (!line.productId) problem.product = 'Vui lòng chọn sản phẩm.'
    else if (seen.has(line.productId)) {
      problem.product = 'Mỗi sản phẩm chỉ được xuất hiện một lần trong yêu cầu.'
    } else seen.add(line.productId)
    if (line.quantity === null || !Number.isInteger(line.quantity) || line.quantity < 1) {
      problem.quantity = 'Số lượng phải là số nguyên lớn hơn 0.'
    } else if (line.quantity > MAX_LINE_QUANTITY) {
      problem.quantity = 'Số lượng quá lớn. Vui lòng kiểm tra lại.'
    }
    if (problem.product || problem.quantity) errors.line[index] = problem
  })

  const ok =
    !errors.source &&
    !errors.destination &&
    !errors.reason &&
    !errors.lines &&
    Object.keys(errors.line).length === 0
  return { ok, errors }
}
