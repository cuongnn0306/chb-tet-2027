import { describe, expect, it } from 'vitest'
import { commissionBreakdown, type CommissionLineInput } from '@/domain/orders/commission'
import { baseCommission } from '@/domain/orders/pricing'

const line = (
  id: string,
  sku: string,
  grossLineAmount: number,
  ratePercent: number,
): CommissionLineInput => ({ id, sku, grossLineAmount, ratePercent })

// Awkward amounts on purpose: every split leaves a remainder that must be handed out.
const MIXED = [
  line('i1', 'P-A', 33_333, 7.5), // exact base 2499.975
  line('i2', 'P-B', 30_003, 12.34), // exact base 3702.3702
  line('i3', 'P-C', 6_993, 0), // an explicit 0% rate
]

describe('commission breakdown (COM-002)', () => {
  it('reproduces the PRD example: 1.000.000 at 20% with 50.000 discount', () => {
    const result = commissionBreakdown([line('i1', 'P-A', 1_000_000, 20)], 50_000)
    expect(result.baseCommission).toBe(200_000)
    expect(result.finalCommission).toBe(150_000)
    expect(result.lines[0]).toMatchObject({
      commissionRevenue: 1_000_000,
      baseCommission: 200_000,
      customerDiscountShare: 50_000,
      finalCommission: 150_000,
    })
  })

  it('hands the rounding remainder to the largest fractional part, keeping both totals exact', () => {
    const result = commissionBreakdown(MIXED, 5_000)
    // floors 2499 + 3702 + 0 = 6201, target floor(6202.3452) = 6202, +1 to P-A (remainder .975)
    expect(result.lines.map((l) => l.baseCommission)).toEqual([2_500, 3_702, 0])
    expect(result.baseCommission).toBe(6_202)
    // discount 5.000 split by gross 33333 : 30003 : 6993 -> floors 2369 + 2133 + 497, +1 to P-A
    expect(result.lines.map((l) => l.customerDiscountShare)).toEqual([2_370, 2_133, 497])
    expect(result.lines.map((l) => l.finalCommission)).toEqual([130, 1_569, -497])
    expect(result.finalCommission).toBe(1_202)
  })

  it('distributes several leftover units when the discount equals the ceiling', () => {
    const result = commissionBreakdown(MIXED, 6_202)
    expect(result.lines.map((l) => l.customerDiscountShare)).toEqual([2_939, 2_646, 617])
    expect(result.finalCommission).toBe(0)
    expect(result.discountWithinBaseCommission).toBe(true)
  })

  it('flags a discount above the base commission instead of hiding it', () => {
    const result = commissionBreakdown(MIXED, 6_203)
    expect(result.discountWithinBaseCommission).toBe(false)
    expect(result.finalCommission).toBe(-1)
  })

  it('base commission equals the order discount ceiling used by ORD-005', () => {
    const pricing = MIXED.map((l) => ({
      listPrice: l.grossLineAmount,
      quantity: 1,
      commissionRatePercent: l.ratePercent,
    }))
    expect(commissionBreakdown(MIXED, 0).baseCommission).toBe(baseCommission(pricing))
  })

  it('honours an explicit 0% rate and a zero discount', () => {
    const result = commissionBreakdown([line('i1', 'P-A', 500_000, 0)], 0)
    expect(result.lines[0]).toMatchObject({ baseCommission: 0, customerDiscountShare: 0 })
  })

  it('breaks ties on the lower SKU, then the lower id, whatever the input order', () => {
    // 3 split over two equal lines: 1.5 each -> floor 1 + 1, one extra unit
    const a = line('i2', 'P-B', 100, 10)
    const b = line('i1', 'P-A', 100, 10)
    const shares = (input: CommissionLineInput[]) =>
      commissionBreakdown(input, 3).lines.map((l) => `${l.sku}:${l.id}=${l.customerDiscountShare}`)
    expect(shares([a, b])).toEqual(['P-A:i1=2', 'P-B:i2=1'])
    expect(shares([b, a])).toEqual(['P-A:i1=2', 'P-B:i2=1'])

    const sameSkuLow = line('i3', 'P-A', 100, 10)
    const sameSkuHigh = line('i9', 'P-A', 100, 10)
    expect(shares([sameSkuHigh, sameSkuLow])).toEqual(['P-A:i3=2', 'P-A:i9=1'])
  })

  it('compares SKUs by byte order so the result does not depend on a locale', () => {
    const lower = line('i1', 'p-a', 100, 10)
    const upper = line('i2', 'P-Z', 100, 10)
    const lines = commissionBreakdown([lower, upper], 1).lines
    expect(lines.map((l) => l.sku)).toEqual(['P-Z', 'p-a']) // uppercase sorts before lowercase
    expect(lines[0]?.customerDiscountShare).toBe(1)
  })

  it('stays exact beyond Number.MAX_SAFE_INTEGER intermediates', () => {
    const big = [line('i1', 'P-A', 9_000_000_000_000, 33.33), line('i2', 'P-B', 1, 99.99)]
    const result = commissionBreakdown(big, 1_000_000_000)
    // 9e12 x 33.33% = 2.9997e12 exactly; the second line adds 0.9999 (floored away)
    expect(result.baseCommission).toBe(2_999_700_000_000)
    expect(result.lines.reduce((s, l) => s + l.customerDiscountShare, 0)).toBe(1_000_000_000)
  })

  it('handles an empty order and a zero-value order without dividing by zero', () => {
    expect(commissionBreakdown([], 0)).toMatchObject({ baseCommission: 0, finalCommission: 0 })
    const free = commissionBreakdown([line('i1', 'P-A', 0, 10)], 0)
    expect(free.lines[0]).toMatchObject({ baseCommission: 0, customerDiscountShare: 0 })
  })

  it('conserves the order totals for many random orders', () => {
    let seed = 20261016
    const next = (max: number) => {
      seed = (seed * 48_271) % 2_147_483_647 // Park-Miller: products stay below 2^53, so it is exact
      return seed % max
    }
    for (let round = 0; round < 300; round++) {
      const count = 1 + next(6)
      const lines = Array.from({ length: count }, (_, i) =>
        line(`i${i}`, `P-${next(4)}`, 1 + next(5_000_000), next(10_001) / 100),
      )
      const ceiling = commissionBreakdown(lines, 0).baseCommission
      const discount = next(ceiling + 1)
      const result = commissionBreakdown(lines, discount)

      expect(result.lines.reduce((s, l) => s + l.baseCommission, 0)).toBe(result.baseCommission)
      expect(result.lines.reduce((s, l) => s + l.customerDiscountShare, 0)).toBe(discount)
      expect(result.lines.reduce((s, l) => s + l.finalCommission, 0)).toBe(result.finalCommission)
      expect(result.finalCommission).toBeGreaterThanOrEqual(0)
      for (const l of result.lines) {
        expect(Number.isInteger(l.baseCommission)).toBe(true)
        expect(l.baseCommission).toBeGreaterThanOrEqual(0)
        expect(l.customerDiscountShare).toBeGreaterThanOrEqual(0)
        // never more than one VND away from the exact proportional value
        const exact = (l.commissionRevenue * l.ratePercent) / 100
        expect(Math.abs(l.baseCommission - exact)).toBeLessThan(count)
      }
      // the same order in another input order yields identical lines
      expect(commissionBreakdown([...lines].reverse(), discount)).toEqual(result)
    }
  })
})
