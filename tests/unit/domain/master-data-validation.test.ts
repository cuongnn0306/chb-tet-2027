import { describe, expect, it } from 'vitest'
import {
  normalizeCode,
  parseInteger,
  parsePercent,
  validateProduct,
  validateCode,
  validateLocation,
  validateLookup,
  validateName,
} from '@/domain/master-data/validation'

describe('code validation', () => {
  it('normalises to trimmed upper case', () => {
    expect(normalizeCode('  hn-vp ')).toBe('HN-VP')
  })

  it('accepts typical codes', () => {
    for (const code of ['HN-VP', 'store', 'A1', 'STAFF_REFERRAL']) {
      expect(validateCode(code)).toBeNull()
    }
  })

  it('rejects empty, accented, spaced and over-long codes', () => {
    expect(validateCode('   ')).toMatch(/nhập mã/)
    expect(validateCode('Cửa hàng')).not.toBeNull()
    expect(validateCode('A B')).not.toBeNull()
    expect(validateCode('-A')).not.toBeNull()
    expect(validateCode('A'.repeat(33))).toMatch(/32/)
  })
})

describe('name validation', () => {
  it('requires a non-blank name', () => {
    expect(validateName('  ')).not.toBeNull()
    expect(validateName('Cửa hàng 1')).toBeNull()
  })
})

describe('parseInteger', () => {
  it('parses whole numbers', () => {
    expect(parseInteger(' 12 ')).toEqual({ value: 12, error: null })
    expect(parseInteger('0')).toEqual({ value: 0, error: null })
  })

  it('rejects blanks, decimals, text and values below the minimum', () => {
    expect(parseInteger('').error).not.toBeNull()
    expect(parseInteger('1.5').error).not.toBeNull()
    expect(parseInteger('abc').error).not.toBeNull()
    expect(parseInteger('-1').error).not.toBeNull()
    expect(parseInteger('-1', { min: -5 }).value).toBe(-1)
    expect(parseInteger('9'.repeat(20)).error).not.toBeNull()
  })
})

describe('form validation', () => {
  it('validates a lookup row', () => {
    expect(validateLookup({ code: 'B2B', name: 'B2B', sortOrder: '4' })).toEqual({})
    expect(Object.keys(validateLookup({ code: '', name: '', sortOrder: 'x' })).sort()).toEqual([
      'code',
      'name',
      'sort_order',
    ])
  })

  it('validates a location row including the type', () => {
    expect(validateLocation({ code: 'HN-VP', name: 'VP', locationType: 'OFFICE' })).toEqual({})
    expect(
      validateLocation({ code: 'HN-VP', name: 'VP', locationType: 'WAREHOUSE' }),
    ).toHaveProperty('location_type')
  })
})

describe('parsePercent', () => {
  it('accepts 0..100 with up to two decimals, dot or comma', () => {
    expect(parsePercent('0').value).toBe(0)
    expect(parsePercent('12.5').value).toBe(12.5)
    expect(parsePercent('12,25').value).toBe(12.25)
    expect(parsePercent('100').value).toBe(100)
  })

  it('rejects blanks, over 100, too many decimals and text', () => {
    expect(parsePercent('').error).not.toBeNull()
    expect(parsePercent('100.01').error).not.toBeNull()
    expect(parsePercent('101').error).not.toBeNull()
    expect(parsePercent('1.234').error).not.toBeNull()
    expect(parsePercent('-1').error).not.toBeNull()
    expect(parsePercent('abc').error).not.toBeNull()
  })
})

describe('validateProduct', () => {
  const valid = {
    sku: 'TT-1200',
    name: 'Bánh chưng truyền thống 1.2kg',
    weightGram: '1200',
    listPrice: '180.000',
    commissionRate: '8',
  }

  it('accepts a valid product, with an optional weight', () => {
    expect(validateProduct(valid)).toEqual({})
    expect(validateProduct({ ...valid, weightGram: '' })).toEqual({})
  })

  it('reports every invalid field', () => {
    const errors = validateProduct({
      sku: '',
      name: '',
      weightGram: '0',
      listPrice: '12.5',
      commissionRate: '120',
    })
    expect(Object.keys(errors).sort()).toEqual([
      'default_commission_rate',
      'list_price',
      'name',
      'sku',
      'weight_gram',
    ])
  })
})
