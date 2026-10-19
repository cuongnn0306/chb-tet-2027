import { describe, expect, it } from 'vitest'
import { customerDisplayName, validateCustomer } from '@/domain/customers/validation'
import { isPlausiblePhone, normalizePhone } from '@/lib/phone'

describe('normalizePhone (CUS-003)', () => {
  it('folds every common Vietnamese format to the domestic number', () => {
    for (const raw of [
      '0901234567',
      '090 123 4567',
      '090.123.4567',
      '+84 90 123 4567',
      '84901234567',
      '0084901234567',
      '(090) 123-4567',
    ]) {
      expect(normalizePhone(raw)).toBe('0901234567')
    }
  })

  it('returns null for empty or digit-less input', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone('abc')).toBeNull()
  })

  it('keeps landline and unusual numbers as digits only', () => {
    expect(normalizePhone('024 3825 1234')).toBe('02438251234')
    expect(normalizePhone('12345')).toBe('12345')
  })

  it('does not treat a domestic number starting with 08 as a country code', () => {
    expect(normalizePhone('0841234567')).toBe('0841234567')
  })
})

describe('isPlausiblePhone', () => {
  it('accepts 9-11 digit domestic numbers', () => {
    expect(isPlausiblePhone('0901234567')).toBe(true)
    expect(isPlausiblePhone('+84 24 3825 1234')).toBe(true)
  })

  it('rejects short, long and non-domestic input', () => {
    expect(isPlausiblePhone('12345')).toBe(false)
    expect(isPlausiblePhone('0123')).toBe(false)
    expect(isPlausiblePhone('090123456789012')).toBe(false)
    expect(isPlausiblePhone('abc')).toBe(false)
  })
})

const blank = {
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

describe('validateCustomer (CUS-002)', () => {
  it('requires a name for individuals and a company name for companies', () => {
    expect(validateCustomer(blank)).toHaveProperty('name')
    expect(validateCustomer({ ...blank, name: 'Nguyễn Văn A' })).toEqual({})
    expect(validateCustomer({ ...blank, customerType: 'COMPANY' })).toHaveProperty('company_name')
    expect(
      validateCustomer({ ...blank, customerType: 'COMPANY', companyName: 'Công ty ABC' }),
    ).toEqual({})
  })

  it('does not require a phone or other optional fields', () => {
    expect(validateCustomer({ ...blank, name: 'A' })).toEqual({})
  })

  it('checks phone, email and tax code only when provided', () => {
    const errors = validateCustomer({
      ...blank,
      customerType: 'COMPANY',
      companyName: 'ABC',
      phone: '123',
      email: 'x',
      taxCode: 'abc',
    })
    expect(Object.keys(errors).sort()).toEqual(['email', 'phone', 'tax_code'])
    expect(
      validateCustomer({
        ...blank,
        customerType: 'COMPANY',
        companyName: 'ABC',
        taxCode: '0100000001-001',
      }),
    ).toEqual({})
  })

  it('rejects an unknown customer type', () => {
    expect(validateCustomer({ ...blank, customerType: 'VIP' })).toHaveProperty('customer_type')
  })
})

describe('customerDisplayName', () => {
  it('uses the company name for companies and the name for individuals', () => {
    expect(
      customerDisplayName({ customer_type: 'COMPANY', name: null, company_name: 'ABC JSC' }),
    ).toBe('ABC JSC')
    expect(
      customerDisplayName({ customer_type: 'INDIVIDUAL', name: 'Chị Lan', company_name: null }),
    ).toBe('Chị Lan')
    expect(
      customerDisplayName({ customer_type: 'INDIVIDUAL', name: ' ', company_name: null }),
    ).toBe('Khách chưa có tên')
  })
})
