import { describe, expect, it } from 'vitest'
import {
  normalizeCode,
  parseInteger,
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
