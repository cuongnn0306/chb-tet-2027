import { describe, expect, it } from 'vitest'
import { monthBounds, monthGrid, monthLabel, shiftMonth } from '@/domain/deliveries/calendar'

describe('delivery calendar dates', () => {
  it('queries the actual month, including a leap February', () => {
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthBounds('2027-02')).toEqual({ from: '2027-02-01', to: '2027-02-28' })
  })

  it('moves across year boundaries', () => {
    expect(shiftMonth('2027-01', -1)).toBe('2026-12')
    expect(shiftMonth('2027-12', 1)).toBe('2028-01')
    expect(monthLabel('2027-01')).toBe('Tháng 1/2027')
  })

  it('aligns Monday first and leaves complete weeks', () => {
    const may = monthGrid('2027-05')
    expect(may.slice(0, 5)).toEqual([null, null, null, null, null])
    expect(may[5]).toBe('2027-05-01')
    expect(may.length % 7).toBe(0)
    expect(may).toContain('2027-05-31')
    expect(may.at(-1)).toBeNull()
    expect(monthGrid('2027-02')[0]).toBe('2027-02-01')
  })
})
