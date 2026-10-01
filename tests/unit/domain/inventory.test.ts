import { describe, expect, it } from 'vitest'
import {
  MANUAL_EXIT_TYPES,
  MOVEMENT_TYPES,
  MOVEMENT_TYPE_LABELS,
  businessDate,
  expiryStatus,
  isMovementType,
  sellableQuantity,
} from '@/domain/inventory/movements'
import { validateBatch, validateStockMove } from '@/domain/inventory/validation'

describe('movement vocabulary', () => {
  it('has the twelve approved movement types, each with a Vietnamese label', () => {
    expect(MOVEMENT_TYPES).toHaveLength(12)
    for (const type of MOVEMENT_TYPES) expect(MOVEMENT_TYPE_LABELS[type]).toBeTruthy()
  })

  it('validates movement types and limits manual exits to sample, gift and damage', () => {
    expect(isMovementType('SALE_OUT')).toBe(true)
    expect(isMovementType('sale_out')).toBe(false)
    expect([...MANUAL_EXIT_TYPES]).toEqual(['SAMPLE_OUT', 'GIFT_OUT', 'DAMAGE_OUT'])
  })
})

describe('sellable quantity (PRD §13)', () => {
  it('subtracts safety stock and never goes negative', () => {
    expect(sellableQuantity(25, 20)).toBe(5)
    expect(sellableQuantity(6, 5)).toBe(1)
    expect(sellableQuantity(3, 10)).toBe(0)
    expect(sellableQuantity(0, 0)).toBe(0)
  })
})

describe('expiryStatus', () => {
  it('flags batches expired before today', () => {
    expect(expiryStatus('2026-10-01', '2026-10-02')).toBe('EXPIRED')
    expect(expiryStatus('2026-10-02', '2026-10-02')).toBe('OK') // expires today: still sellable today
  })

  it('flags batches expiring within the alert window when configured', () => {
    expect(expiryStatus('2026-10-10', '2026-10-02', 14)).toBe('EXPIRING_SOON')
    expect(expiryStatus('2026-10-16', '2026-10-02', 14)).toBe('EXPIRING_SOON') // exactly 14 days
    expect(expiryStatus('2026-10-17', '2026-10-02', 14)).toBe('OK')
    expect(expiryStatus('2026-10-10', '2026-10-02')).toBe('OK') // no window configured
  })

  it('works across month and year boundaries', () => {
    expect(expiryStatus('2027-01-05', '2026-12-25', 14)).toBe('EXPIRING_SOON')
  })
})

describe('businessDate', () => {
  it('uses Vietnam time (UTC+7)', () => {
    expect(businessDate(new Date('2026-10-02T16:59:00Z'))).toBe('2026-10-02')
    expect(businessDate(new Date('2026-10-02T17:00:00Z'))).toBe('2026-10-03')
  })
})

describe('validateBatch (INV-001)', () => {
  const valid = {
    productId: 'p1',
    batchCode: 'lo-2027-01',
    manufacturedDate: '2027-01-10',
    expiryDate: '2027-03-10',
  }

  it('accepts a valid batch', () => {
    expect(validateBatch(valid)).toEqual({})
    expect(validateBatch({ ...valid, expiryDate: '2027-01-10' })).toEqual({}) // same day is allowed
  })

  it('rejects missing product, bad code and bad dates', () => {
    const errors = validateBatch({
      productId: '',
      batchCode: '',
      manufacturedDate: '',
      expiryDate: '',
    })
    expect(Object.keys(errors).sort()).toEqual([
      'batch_code',
      'expiry_date',
      'manufactured_date',
      'product',
    ])
    expect(validateBatch({ ...valid, expiryDate: '2027-01-09' })).toHaveProperty('expiry_date')
    expect(validateBatch({ ...valid, manufacturedDate: '2027-02-30' })).toHaveProperty(
      'manufactured_date',
    )
  })
})

describe('validateStockMove (INV-005/010/011)', () => {
  const valid = { locationId: 'l', batchId: 'b', quantity: '5', reason: '', reasonRequired: false }

  it('accepts a positive whole quantity', () => {
    expect(validateStockMove(valid)).toEqual({})
  })

  it('requires a reason only when asked', () => {
    expect(validateStockMove({ ...valid, reasonRequired: true })).toHaveProperty('reason')
    expect(validateStockMove({ ...valid, reasonRequired: true, reason: 'Kiểm kê' })).toEqual({})
  })

  it('rejects zero, negative, fractional and empty quantities and missing selections', () => {
    for (const quantity of ['0', '-1', '1.5', '', 'abc']) {
      expect(validateStockMove({ ...valid, quantity })).toHaveProperty('quantity')
    }
    expect(
      Object.keys(validateStockMove({ ...valid, locationId: '', batchId: '' })).sort(),
    ).toEqual(['batch', 'location'])
  })
})
