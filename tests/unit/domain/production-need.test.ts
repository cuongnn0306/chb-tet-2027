import { describe, expect, it } from 'vitest'
import {
  calculateProductionNeed,
  type ProductionNeedInput,
  type ProductionNeedResult,
} from '@/domain/production/need'

const input = (over: Partial<ProductionNeedInput> = {}): ProductionNeedInput => ({
  committedDemand: 0,
  safetyTarget: 0,
  available: 0,
  scheduled: 0,
  ...over,
})

function suggested(result: ProductionNeedResult): number {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.issues)}`)
  return result.suggestedQty
}

describe('calculateProductionNeed (PRD-002)', () => {
  it('suggests nothing when every quantity is zero', () => {
    expect(calculateProductionNeed(input())).toEqual({
      ok: true,
      suggestedQty: 0,
      requirement: 0,
      supply: 0,
    })
  })

  it('suggests the shortage: demand + safety - available - scheduled', () => {
    const result = calculateProductionNeed(
      input({ committedDemand: 500, safetyTarget: 100, available: 200 }),
    )
    expect(result).toEqual({ ok: true, suggestedQty: 400, requirement: 600, supply: 200 })
  })

  it('counts the safety target even with no committed demand', () => {
    expect(suggested(calculateProductionNeed(input({ safetyTarget: 80, available: 30 })))).toBe(50)
  })

  it('subtracts scheduled production so it is not produced twice', () => {
    const base = input({ committedDemand: 500, safetyTarget: 100, available: 200 })
    expect(suggested(calculateProductionNeed({ ...base, scheduled: 150 }))).toBe(250)
    expect(suggested(calculateProductionNeed({ ...base, scheduled: 400 }))).toBe(0)
  })

  it('floors at zero when supply exceeds the need, and exposes both sides', () => {
    const result = calculateProductionNeed(
      input({ committedDemand: 100, safetyTarget: 20, available: 300, scheduled: 50 }),
    )
    expect(result).toEqual({ ok: true, suggestedQty: 0, requirement: 120, supply: 350 })
  })

  it('suggests zero when supply exactly meets the need', () => {
    expect(
      suggested(
        calculateProductionNeed(
          input({ committedDemand: 70, safetyTarget: 30, available: 60, scheduled: 40 }),
        ),
      ),
    ).toBe(0)
  })

  it('stays exact at the top of the safe-integer range', () => {
    const max = Number.MAX_SAFE_INTEGER
    expect(suggested(calculateProductionNeed(input({ committedDemand: max })))).toBe(max)
    expect(
      suggested(calculateProductionNeed(input({ committedDemand: max, available: max }))),
    ).toBe(0)
    expect(
      suggested(calculateProductionNeed(input({ committedDemand: max - 1, safetyTarget: 1 }))),
    ).toBe(max)
  })

  describe('invalid input is reported, never coerced', () => {
    const bad: [string, unknown, string][] = [
      ['negative', -1, 'NEGATIVE'],
      ['negative zero', -0, 'NEGATIVE'],
      ['fraction', 1.5, 'NOT_INTEGER'],
      ['NaN', Number.NaN, 'NOT_A_NUMBER'],
      ['Infinity', Number.POSITIVE_INFINITY, 'NOT_A_NUMBER'],
      ['-Infinity', Number.NEGATIVE_INFINITY, 'NOT_A_NUMBER'],
      ['numeric string', '5', 'NOT_A_NUMBER'],
      ['null', null, 'NOT_A_NUMBER'],
      ['undefined', undefined, 'NOT_A_NUMBER'],
      ['bigint', 5n, 'NOT_A_NUMBER'],
      ['2^53 (not a safe integer)', 2 ** 53, 'UNSAFE_INTEGER'],
      ['1e300', 1e300, 'UNSAFE_INTEGER'],
    ]

    for (const field of ['committedDemand', 'safetyTarget', 'available', 'scheduled'] as const) {
      for (const [label, value, code] of bad) {
        it(`${field}: ${label} -> ${code}`, () => {
          const result = calculateProductionNeed(input({ [field]: value as number }))
          expect(result).toEqual({ ok: false, issues: [{ field, code }] })
        })
      }
    }

    it('reports every bad field together and returns no quantity', () => {
      const result = calculateProductionNeed(
        input({ committedDemand: -5, safetyTarget: 2.5, available: Number.NaN, scheduled: 3 }),
      )
      expect(result).toEqual({
        ok: false,
        issues: [
          { field: 'committedDemand', code: 'NEGATIVE' },
          { field: 'safetyTarget', code: 'NOT_INTEGER' },
          { field: 'available', code: 'NOT_A_NUMBER' },
        ],
      })
    })

    it('does not mistake a missing field for zero', () => {
      const partial = { committedDemand: 10, safetyTarget: 0, available: 0 } as ProductionNeedInput
      expect(calculateProductionNeed(partial)).toEqual({
        ok: false,
        issues: [{ field: 'scheduled', code: 'NOT_A_NUMBER' }],
      })
    })
  })

  describe('sum overflow', () => {
    const max = Number.MAX_SAFE_INTEGER

    it('rejects a requirement beyond the safe range instead of returning an inexact number', () => {
      expect(calculateProductionNeed(input({ committedDemand: max, safetyTarget: 1 }))).toEqual({
        ok: false,
        issues: [{ field: 'requirement', code: 'SUM_OVERFLOW' }],
      })
    })

    it('rejects a supply beyond the safe range even though the shortage would be zero', () => {
      expect(calculateProductionNeed(input({ available: max, scheduled: 1 }))).toEqual({
        ok: false,
        issues: [{ field: 'supply', code: 'SUM_OVERFLOW' }],
      })
    })

    it('reports both sides when both overflow', () => {
      expect(
        calculateProductionNeed({
          committedDemand: max,
          safetyTarget: max,
          available: max,
          scheduled: max,
        }),
      ).toEqual({
        ok: false,
        issues: [
          { field: 'requirement', code: 'SUM_OVERFLOW' },
          { field: 'supply', code: 'SUM_OVERFLOW' },
        ],
      })
    })

    it('accepts the largest sums that are still exact', () => {
      const half = Math.floor(max / 2)
      const result = calculateProductionNeed(
        input({ committedDemand: half, safetyTarget: half, available: 1 }),
      )
      expect(result).toEqual({
        ok: true,
        suggestedQty: half * 2 - 1,
        requirement: half * 2,
        supply: 1,
      })
    })
  })
})
