import { describe, expect, it } from 'vitest'
import {
  baseCommission,
  checkDiscount,
  lineGross,
  maxDiscount,
  orderGross,
  orderTotals,
  type PricedLine,
} from '@/domain/orders/pricing'

const line = (listPrice: number, quantity: number, commissionRatePercent: number): PricedLine => ({
  listPrice,
  quantity,
  commissionRatePercent,
})

describe('order pricing (ORD-004)', () => {
  it('computes gross as list price x quantity, never from net', () => {
    expect(lineGross(180000, 3)).toBe(540000)
    expect(orderGross([line(180000, 3, 8), line(90000, 2, 8)])).toBe(720000)
  })

  it('reproduces the PRD example: 1.000.000, 20% commission, 50.000 discount', () => {
    const lines = [line(1_000_000, 1, 20)]
    expect(baseCommission(lines)).toBe(200_000)
    expect(orderTotals(lines, 50_000)).toEqual({
      gross: 1_000_000,
      discount: 50_000,
      net: 950_000,
      finalCommission: 150_000,
    })
  })

  it('keeps net = gross - discount for any discount', () => {
    const lines = [line(130000, 7, 8)]
    for (const discount of [0, 1, 1000, 72800]) {
      const totals = orderTotals(lines, discount)
      expect(totals.net).toBe(totals.gross - discount)
    }
  })
})

describe('commission ceiling (ORD-005)', () => {
  it('sums commission per line with each line rate', () => {
    // 180000 x 3 x 8% = 43200 ; 450000 x 1 x 10% = 45000
    expect(baseCommission([line(180000, 3, 8), line(450000, 1, 10)])).toBe(88_200)
  })

  it('floors fractional commission (conservative)', () => {
    // 90000 x 1 x 7.5% = 6750 exactly; 100003 x 1 x 5% = 5000.15 -> 5000
    expect(baseCommission([line(90000, 1, 7.5)])).toBe(6750)
    expect(baseCommission([line(100003, 1, 5)])).toBe(5000)
  })

  it('handles values beyond Number.MAX_SAFE_INTEGER intermediates without error', () => {
    const big = [line(900_000_000, 100_000, 99.99)]
    expect(baseCommission(big)).toBe(Math.floor((900_000_000 * 100_000 * 9999) / 10_000))
  })

  it('allows a discount up to the ceiling and rejects one above it', () => {
    const lines = [line(1_000_000, 1, 20)]
    expect(checkDiscount(200_000, lines)).toEqual({ ok: true })
    expect(checkDiscount(200_001, lines)).toEqual({
      ok: false,
      reason: 'above_commission',
      max: 200_000,
    })
  })

  it('never allows a discount above the order value, even with a high commission', () => {
    const lines = [line(1000, 1, 100)]
    expect(maxDiscount(lines)).toBe(1000)
    expect(checkDiscount(1001, lines)).toEqual({ ok: false, reason: 'above_gross', max: 1000 })
  })

  it('rejects negative or fractional discounts', () => {
    const lines = [line(1_000_000, 1, 20)]
    expect(checkDiscount(-1, lines).ok).toBe(false)
    expect(checkDiscount(1.5, lines).ok).toBe(false)
  })

  it('allows no discount when the commission rate is 0', () => {
    const lines = [line(1_000_000, 1, 0)]
    expect(maxDiscount(lines)).toBe(0)
    expect(checkDiscount(1, lines)).toEqual({ ok: false, reason: 'above_commission', max: 0 })
    expect(checkDiscount(0, lines)).toEqual({ ok: true })
  })
})
