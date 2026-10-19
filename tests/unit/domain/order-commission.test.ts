import { describe, expect, it } from 'vitest'
import {
  commissionBreakdown,
  type CommissionBreakdown,
  type CommissionLineInput,
} from '@/domain/orders/commission'
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

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/** The invariants every breakdown must satisfy, whatever the inputs. */
function expectReconciled(result: CommissionBreakdown, discount: number) {
  const { lines } = result
  expect(sum(lines.map((l) => l.baseCommission))).toBe(result.baseCommission)
  expect(sum(lines.map((l) => l.customerDiscountShare))).toBe(discount)
  expect(sum(lines.map((l) => l.commissionDeduction))).toBe(result.commissionFundedDiscount)
  expect(sum(lines.map((l) => l.payableCommission))).toBe(result.payableCommission)
  // every VND of the customer discount is accounted for: commission-funded + company-borne
  expect(result.commissionFundedDiscount + result.companyBorneExcess).toBe(discount)
  expect(result.commissionFundedDiscount).toBe(Math.min(discount, result.baseCommission))
  expect(result.payableCommission).toBe(result.baseCommission - result.commissionFundedDiscount)
  expect(result.discountWithinBaseCommission).toBe(discount <= result.baseCommission)
  for (const l of lines) {
    expect(Number.isInteger(l.commissionDeduction)).toBe(true)
    expect(l.commissionDeduction).toBeGreaterThanOrEqual(0)
    expect(l.commissionDeduction).toBeLessThanOrEqual(l.baseCommission)
    expect(l.payableCommission).toBe(l.baseCommission - l.commissionDeduction)
    expect(l.payableCommission).toBeGreaterThanOrEqual(0)
  }
}

describe('commission breakdown (COM-002)', () => {
  it('reproduces the PRD example: 1.000.000 at 20% with 50.000 discount', () => {
    const result = commissionBreakdown([line('i1', 'P-A', 1_000_000, 20)], 50_000)
    expect(result.baseCommission).toBe(200_000)
    expect(result.payableCommission).toBe(150_000)
    expect(result.companyBorneExcess).toBe(0)
    expect(result.lines[0]).toMatchObject({
      commissionRevenue: 1_000_000,
      baseCommission: 200_000,
      customerDiscountShare: 50_000,
      commissionDeduction: 50_000,
      payableCommission: 150_000,
    })
  })

  it('hands the rounding remainder to the largest fractional part, keeping both totals exact', () => {
    const result = commissionBreakdown(MIXED, 5_000)
    // floors 2499 + 3702 + 0 = 6201, target floor(6202.3452) = 6202, +1 to P-A (remainder .975)
    expect(result.lines.map((l) => l.baseCommission)).toEqual([2_500, 3_702, 0])
    expect(result.baseCommission).toBe(6_202)
    // discount 5.000 split by gross 33333 : 30003 : 6993 -> floors 2369 + 2133 + 497, +1 to P-A
    expect(result.lines.map((l) => l.customerDiscountShare)).toEqual([2_370, 2_133, 497])
    expectReconciled(result, 5_000)
  })

  it('never shows a negative payable commission: the 0% line has its 497 funded by the others', () => {
    const result = commissionBreakdown(MIXED, 5_000)
    // own part min(share, base) = 2370 / 2133 / 0; the other 497 is spread over the room 130 / 1569 / 0
    // proportionally: 497 x 130/1699 = 38.03, 497 x 1569/1699 = 458.97 -> 38 + 459 (largest remainder)
    expect(result.lines.map((l) => l.commissionDeduction)).toEqual([2_408, 2_592, 0])
    expect(result.lines.map((l) => l.payableCommission)).toEqual([92, 1_110, 0])
    expect(result.payableCommission).toBe(1_202) // still base - discount for an ordinary order
    expect(result.companyBorneExcess).toBe(0)
    // the customer discount attribution is untouched, so a return of the 0% line still credits 497
    expect(result.lines[2]?.customerDiscountShare).toBe(497)
  })

  it('distributes several leftover units when the discount equals the ceiling', () => {
    const result = commissionBreakdown(MIXED, 6_202)
    expect(result.lines.map((l) => l.customerDiscountShare)).toEqual([2_939, 2_646, 617])
    expect(result.lines.map((l) => l.commissionDeduction)).toEqual([2_500, 3_702, 0])
    expect(result.lines.map((l) => l.payableCommission)).toEqual([0, 0, 0])
    expect(result.companyBorneExcess).toBe(0)
    expect(result.discountWithinBaseCommission).toBe(true)
    expectReconciled(result, 6_202)
  })

  it('makes the company bear the excess when the discount exceeds the base commission', () => {
    const result = commissionBreakdown(MIXED, 6_203)
    expect(result.discountWithinBaseCommission).toBe(false)
    expect(result.commissionFundedDiscount).toBe(6_202)
    expect(result.companyBorneExcess).toBe(1)
    expect(result.payableCommission).toBe(0)
    expectReconciled(result, 6_203)
  })

  it('handles a rate cut after drafting: 1% on the first line, 5.000 discount', () => {
    const cut = [
      line('i1', 'P-A', 33_333, 1),
      MIXED[1] as CommissionLineInput,
      MIXED[2] as CommissionLineInput,
    ]
    const result = commissionBreakdown(cut, 5_000)
    expect(result.lines.map((l) => l.baseCommission)).toEqual([333, 3_702, 0])
    expect(result.baseCommission).toBe(4_035)
    expect(result.lines.map((l) => l.customerDiscountShare)).toEqual([2_370, 2_133, 497])
    expect(result.lines.map((l) => l.commissionDeduction)).toEqual([333, 3_702, 0])
    expect(result.lines.map((l) => l.payableCommission)).toEqual([0, 0, 0])
    expect(result.commissionFundedDiscount).toBe(4_035)
    expect(result.companyBorneExcess).toBe(965)
    expect(result.customerDiscount).toBe(5_000) // the customer still gets the whole discount
    expectReconciled(result, 5_000)
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
    expect(result.lines[0]).toMatchObject({
      baseCommission: 0,
      customerDiscountShare: 0,
      commissionDeduction: 0,
      payableCommission: 0,
    })
  })

  it('a discount on an all-0% order is entirely company-borne and nothing goes negative', () => {
    const result = commissionBreakdown(
      [line('i1', 'P-A', 1_000, 0), line('i2', 'P-B', 3_000, 0)],
      400,
    )
    expect(result.lines.map((l) => l.customerDiscountShare)).toEqual([100, 300])
    expect(result.lines.map((l) => l.payableCommission)).toEqual([0, 0])
    expect(result.companyBorneExcess).toBe(400)
    expectReconciled(result, 400)
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

  it('breaks ties of the deduction spread on the lower SKU as well', () => {
    // P-C (0%) carries 11 of the discount; its 11 is spread over the rooms 9 / 9 of P-A and P-B:
    // 11 x 9/18 = 5.5 each, equal remainders -> the odd unit goes to the lower SKU (P-A).
    const input = [
      line('i1', 'P-A', 100, 10),
      line('i2', 'P-B', 100, 10),
      line('i3', 'P-C', 1_000, 0),
    ]
    const result = commissionBreakdown(input, 13)
    expect(result.lines.map((l) => l.customerDiscountShare)).toEqual([1, 1, 11])
    expect(result.lines.map((l) => l.commissionDeduction)).toEqual([7, 6, 0])
    expect(result.lines.map((l) => l.payableCommission)).toEqual([3, 4, 0])
    expect(commissionBreakdown([...input].reverse(), 13)).toEqual(result)
    expectReconciled(result, 13)
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
    expectReconciled(result, 1_000_000_000)
    // and an excess of the same size on the large order
    const over = commissionBreakdown(big, 3_000_000_000_001)
    expect(over.companyBorneExcess).toBe(3_000_000_000_001 - 2_999_700_000_000)
    expect(over.payableCommission).toBe(0)
    expectReconciled(over, 3_000_000_000_001)
  })

  it('handles an empty order and a zero-value order without dividing by zero', () => {
    expect(commissionBreakdown([], 0)).toMatchObject({ baseCommission: 0, payableCommission: 0 })
    const free = commissionBreakdown([line('i1', 'P-A', 0, 10)], 0)
    expect(free.lines[0]).toMatchObject({ baseCommission: 0, customerDiscountShare: 0 })
  })

  it('reconciles many random orders, with and without a discount above the commission', () => {
    let seed = 20261017
    const next = (max: number) => {
      seed = (seed * 48_271) % 2_147_483_647 // Park-Miller: products stay below 2^53, so it is exact
      return seed % max
    }
    for (let round = 0; round < 400; round++) {
      const count = 1 + next(6)
      const lines = Array.from({ length: count }, (_, i) =>
        line(`i${i}`, `P-${next(4)}`, 1 + next(5_000_000), next(3) === 0 ? 0 : next(10_001) / 100),
      )
      const ceiling = commissionBreakdown(lines, 0).baseCommission
      // up to 1.5x the ceiling: a third of the rounds exceed it
      const discount = next(Math.floor(ceiling * 1.5) + 1)
      const result = commissionBreakdown(lines, discount)

      expectReconciled(result, discount)
      if (discount <= ceiling) {
        expect(result.companyBorneExcess).toBe(0)
        expect(result.payableCommission).toBe(ceiling - discount) // ordinary order: base - discount
      } else {
        expect(result.payableCommission).toBe(0)
        expect(result.companyBorneExcess).toBe(discount - ceiling)
      }
      for (const l of result.lines) {
        // base never more than one VND per line away from the exact proportional value
        const exact = (l.commissionRevenue * l.ratePercent) / 100
        expect(Math.abs(l.baseCommission - exact)).toBeLessThan(count)
      }
      // the same order in another input order yields identical lines
      expect(commissionBreakdown([...lines].reverse(), discount)).toEqual(result)
    }
  })
})
