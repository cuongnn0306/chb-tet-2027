import type { FieldErrors } from '@/domain/master-data/validation'
import { parseInteger } from '@/domain/master-data/validation'
import { parseVnd } from '@/lib/money'

/** Fastest-entry order form (PRD §25): customer, products, quantity, attribution, discount. */
export interface LineInput {
  productId: string
  /** Typed text; parsed to a whole number on validation. */
  quantity: string
}

export interface OrderFormInput {
  customerId: string
  lines: LineInput[]
  /** Typed VND amount; blank means no discount. */
  discount: string
  locationId: string
  channelId: string
  sourceId: string
}

export interface ParsedOrderForm {
  items: { productId: string; quantity: number }[]
  discountAmount: number
}

export interface OrderFormResult {
  errors: FieldErrors
  parsed: ParsedOrderForm | null
}

/** Field keys: customer, lines, line:<index>, discount, location, channel, source. */
export function validateOrderForm(input: OrderFormInput): OrderFormResult {
  const errors: FieldErrors = {}

  if (input.customerId === '') errors.customer = 'Vui lòng chọn hoặc tạo khách hàng.'
  if (input.locationId === '') errors.location = 'Vui lòng chọn điểm tạo đơn.'
  if (input.channelId === '') errors.channel = 'Vui lòng chọn kênh bán.'
  if (input.sourceId === '') errors.source = 'Vui lòng chọn nguồn khách.'

  const items: ParsedOrderForm['items'] = []
  if (input.lines.length === 0) {
    errors.lines = 'Vui lòng thêm ít nhất một sản phẩm.'
  }
  input.lines.forEach((line, index) => {
    const quantity = parseInteger(line.quantity, { min: 1, label: 'Số lượng' })
    if (quantity.error !== null) errors[`line:${index}`] = quantity.error
    else items.push({ productId: line.productId, quantity: quantity.value })
  })

  let discountAmount = 0
  if (input.discount.trim() !== '') {
    const discount = parseVnd(input.discount, { label: 'Giảm giá' })
    if (discount.error !== null) errors.discount = discount.error
    else discountAmount = discount.value
  }

  if (Object.keys(errors).length > 0) return { errors, parsed: null }
  return { errors, parsed: { items, discountAmount } }
}
