import type { FieldErrors } from '@/domain/master-data/validation'
import { isPlausiblePhone } from '@/lib/phone'

export const CUSTOMER_TYPES = ['INDIVIDUAL', 'COMPANY'] as const
export type CustomerType = (typeof CUSTOMER_TYPES)[number]

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  INDIVIDUAL: 'Khách cá nhân',
  COMPANY: 'Khách doanh nghiệp',
}

export interface CustomerFields {
  customerType: string
  name: string
  phone: string
  address: string
  companyName: string
  taxCode: string
  contactName: string
  contactTitle: string
  email: string
  companyAddress: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TAX_CODE_PATTERN = /^[0-9][0-9-]{7,14}$/

/** What to show as the customer's name: the company for businesses, the person otherwise. */
export function customerDisplayName(customer: {
  customer_type: string
  name: string | null
  company_name: string | null
}): string {
  const label = customer.customer_type === 'COMPANY' ? customer.company_name : customer.name
  return (label ?? '').trim() || 'Khách chưa có tên'
}

/** Required fields mirror the database check: a person needs a name, a company needs its name. */
export function validateCustomer(input: CustomerFields): FieldErrors {
  const errors: FieldErrors = {}
  const company = input.customerType === 'COMPANY'

  if (!(CUSTOMER_TYPES as readonly string[]).includes(input.customerType)) {
    errors.customer_type = 'Vui lòng chọn loại khách.'
    return errors
  }
  if (company) {
    if (input.companyName.trim() === '') errors.company_name = 'Vui lòng nhập tên công ty.'
    if (input.taxCode.trim() !== '' && !TAX_CODE_PATTERN.test(input.taxCode.trim())) {
      errors.tax_code = 'Mã số thuế chỉ gồm chữ số và dấu gạch ngang (8–15 ký tự).'
    }
  } else if (input.name.trim() === '') {
    errors.name = 'Vui lòng nhập tên khách hàng.'
  }
  if (input.phone.trim() !== '' && !isPlausiblePhone(input.phone)) {
    errors.phone = 'Số điện thoại chưa đúng. Ví dụ: 0901 234 567 hoặc +84 901 234 567.'
  }
  if (input.email.trim() !== '' && !EMAIL_PATTERN.test(input.email.trim())) {
    errors.email = 'Email chưa đúng định dạng.'
  }
  return errors
}
