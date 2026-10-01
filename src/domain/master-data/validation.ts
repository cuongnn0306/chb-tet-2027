import { parseVnd } from '@/lib/money'

/** Pure input validation for master-data forms (messages are user-facing Vietnamese). */
export type FieldErrors = Record<string, string>

export const LOCATION_TYPES = ['CENTRAL_KITCHEN', 'OFFICE', 'STORE', 'FRANCHISE'] as const
export type LocationType = (typeof LOCATION_TYPES)[number]

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  CENTRAL_KITCHEN: 'Bếp tổng',
  OFFICE: 'Văn phòng',
  STORE: 'Cửa hàng CHB',
  FRANCHISE: 'Cơ sở nhượng quyền',
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/
const CODE_MAX_LENGTH = 32
const NAME_MAX_LENGTH = 200

/** Codes are stored trimmed and upper-case so the same code cannot exist in two spellings. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase()
}

export function validateCode(raw: string): string | null {
  const code = normalizeCode(raw)
  if (code === '') return 'Vui lòng nhập mã.'
  if (code.length > CODE_MAX_LENGTH) return `Mã tối đa ${CODE_MAX_LENGTH} ký tự.`
  if (!CODE_PATTERN.test(code))
    return 'Mã chỉ gồm chữ không dấu, số, dấu gạch ngang hoặc gạch dưới.'
  return null
}

export function validateName(raw: string, label = 'tên'): string | null {
  const name = raw.trim()
  if (name === '') return `Vui lòng nhập ${label}.`
  if (name.length > NAME_MAX_LENGTH) return `Tối đa ${NAME_MAX_LENGTH} ký tự.`
  return null
}

/** Whole number >= min (e.g. sort order, safety stock). Returns the parsed value or an error. */
export function parseInteger(
  raw: string,
  { min = 0, label = 'Giá trị' }: { min?: number; label?: string } = {},
): { value: number; error: null } | { value: null; error: string } {
  const text = raw.trim()
  if (text === '') return { value: null, error: `${label} không được để trống.` }
  if (!/^-?\d+$/.test(text)) return { value: null, error: `${label} phải là số nguyên.` }
  const value = Number(text)
  if (!Number.isSafeInteger(value)) return { value: null, error: `${label} quá lớn.` }
  if (value < min) return { value: null, error: `${label} phải từ ${min} trở lên.` }
  return { value, error: null }
}

function collect(errors: FieldErrors, field: string, message: string | null) {
  if (message) errors[field] = message
}

export interface LookupInput {
  code: string
  name: string
  sortOrder: string
}

/** Sales channels and lead sources share the same shape. */
export function validateLookup(input: LookupInput): FieldErrors {
  const errors: FieldErrors = {}
  collect(errors, 'code', validateCode(input.code))
  collect(errors, 'name', validateName(input.name))
  collect(errors, 'sort_order', parseInteger(input.sortOrder, { label: 'Thứ tự' }).error)
  return errors
}

export interface LocationInput {
  code: string
  name: string
  locationType: string
}

export function validateLocation(input: LocationInput): FieldErrors {
  const errors: FieldErrors = {}
  collect(errors, 'code', validateCode(input.code))
  collect(errors, 'name', validateName(input.name))
  if (!(LOCATION_TYPES as readonly string[]).includes(input.locationType)) {
    errors.location_type = 'Vui lòng chọn loại địa điểm.'
  }
  return errors
}

/** Percentage with at most two decimals, 0..100 ("12", "12.5", "12,5"). */
export function parsePercent(
  raw: string,
  { label = 'Tỷ lệ' }: { label?: string } = {},
): { value: number; error: null } | { value: null; error: string } {
  const text = raw.trim().replace(',', '.')
  if (text === '') return { value: null, error: `${label} không được để trống.` }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { value: null, error: `${label} phải là số, tối đa 2 chữ số thập phân.` }
  }
  const value = Number(text)
  if (value > 100) return { value: null, error: `${label} không được vượt quá 100%.` }
  return { value, error: null }
}

export interface ProductInput {
  sku: string
  name: string
  weightGram: string
  listPrice: string
  commissionRate: string
}

export function validateProduct(input: ProductInput): FieldErrors {
  const errors: FieldErrors = {}
  collect(errors, 'sku', validateCode(input.sku))
  collect(errors, 'name', validateName(input.name, 'tên sản phẩm'))
  if (input.weightGram.trim() !== '') {
    collect(
      errors,
      'weight_gram',
      parseInteger(input.weightGram, { min: 1, label: 'Khối lượng' }).error,
    )
  }
  collect(errors, 'list_price', parseVnd(input.listPrice, { label: 'Giá niêm yết' }).error)
  collect(
    errors,
    'default_commission_rate',
    parsePercent(input.commissionRate, { label: '% hoa hồng' }).error,
  )
  return errors
}

/** True for a real calendar date written as YYYY-MM-DD (what <input type="date"> produces). */
export function isIsoDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false
  const date = new Date(`${raw}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw
}

export interface CommissionRuleInput {
  userId: string
  roleId: string
  rate: string
  effectiveFrom: string
  effectiveTo: string
}

/** A rule targets exactly one of user or role (TECH_DESIGN §3.22 priority list); product is optional. */
export function validateCommissionRule(input: CommissionRuleInput): FieldErrors {
  const errors: FieldErrors = {}
  const targets = [input.userId, input.roleId].filter((value) => value !== '')
  if (targets.length !== 1) {
    errors.user_id =
      'Chọn một nhân viên hoặc một vai trò (không chọn cả hai, không bỏ trống cả hai).'
  }
  collect(errors, 'rate_percent', parsePercent(input.rate, { label: '% hoa hồng' }).error)
  if (!isIsoDate(input.effectiveFrom)) {
    errors.effective_from = 'Vui lòng chọn ngày bắt đầu hiệu lực.'
  }
  if (input.effectiveTo !== '') {
    if (!isIsoDate(input.effectiveTo)) errors.effective_to = 'Ngày kết thúc không hợp lệ.'
    else if (isIsoDate(input.effectiveFrom) && input.effectiveTo < input.effectiveFrom) {
      errors.effective_to = 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.'
    }
  }
  return errors
}
