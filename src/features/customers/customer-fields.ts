import type { CustomerFields } from '@/domain/customers/validation'
import type { Customer } from '@/services/customers.service'

const EMPTY: CustomerFields = {
  customerType: 'INDIVIDUAL',
  name: '',
  phone: '',
  address: '',
  companyName: '',
  taxCode: '',
  contactName: '',
  contactTitle: '',
  email: '',
  companyAddress: '',
}

/** Form values for a customer (or an empty individual when creating). */
export function customerToFields(customer: Customer | null): CustomerFields {
  if (!customer) return EMPTY
  return {
    customerType: customer.customer_type,
    name: customer.name ?? '',
    phone: customer.phone ?? '',
    address: customer.address ?? '',
    companyName: customer.company_name ?? '',
    taxCode: customer.tax_code ?? '',
    contactName: customer.contact_name ?? '',
    contactTitle: customer.contact_title ?? '',
    email: customer.email ?? '',
    companyAddress: customer.company_address ?? '',
  }
}
