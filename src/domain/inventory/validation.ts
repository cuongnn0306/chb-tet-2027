import {
  isIsoDate,
  parseInteger,
  validateCode,
  type FieldErrors,
} from '@/domain/master-data/validation'

const collect = (errors: FieldErrors, field: string, message: string | null) => {
  if (message) errors[field] = message
}

export interface BatchInput {
  productId: string
  batchCode: string
  manufacturedDate: string
  expiryDate: string
}

/** Batch form (INV-001): code + dates. Product is chosen, never typed. */
export function validateBatch(input: BatchInput): FieldErrors {
  const errors: FieldErrors = {}
  if (input.productId === '') errors.product = 'Vui lòng chọn sản phẩm.'
  collect(errors, 'batch_code', validateCode(input.batchCode))
  if (!isIsoDate(input.manufacturedDate)) errors.manufactured_date = 'Vui lòng chọn ngày sản xuất.'
  if (!isIsoDate(input.expiryDate)) errors.expiry_date = 'Vui lòng chọn hạn sử dụng.'
  else if (isIsoDate(input.manufacturedDate) && input.expiryDate < input.manufacturedDate) {
    errors.expiry_date = 'Hạn sử dụng phải sau hoặc bằng ngày sản xuất.'
  }
  return errors
}

export interface StockMoveInput {
  locationId: string
  batchId: string
  quantity: string
  reason: string
  /** Whether a reason is mandatory for this kind of movement. */
  reasonRequired: boolean
}

/** Shared form for opening stock, adjustment and sample/gift/damage exits. Quantity is a whole number >= 1. */
export function validateStockMove(input: StockMoveInput): FieldErrors {
  const errors: FieldErrors = {}
  if (input.locationId === '') errors.location = 'Vui lòng chọn địa điểm.'
  if (input.batchId === '') errors.batch = 'Vui lòng chọn lô hàng.'
  collect(errors, 'quantity', parseInteger(input.quantity, { min: 1, label: 'Số lượng' }).error)
  if (input.reasonRequired && input.reason.trim() === '') errors.reason = 'Vui lòng nhập lý do.'
  return errors
}
