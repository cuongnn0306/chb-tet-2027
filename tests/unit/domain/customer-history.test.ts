import { describe, expect, it } from 'vitest'
import { describeHistory, lastOrderDate } from '@/domain/customers/history'

describe('customer history text (CUS-005)', () => {
  it('shows the order count and gross total', () => {
    const text = describeHistory({ orderCount: 3, totalGross: 4_800_000, lastOrderAt: null })
    expect(text.replace(/\s+/g, ' ')).toBe('3 đơn · 4.800.000 ₫')
  })

  it('says there are no orders when absent or zero', () => {
    expect(describeHistory(undefined)).toBe('Chưa có đơn')
    expect(describeHistory({ orderCount: 0, totalGross: 0, lastOrderAt: null })).toBe('Chưa có đơn')
  })

  it('formats the latest order date in Vietnam time (UTC+7)', () => {
    expect(
      lastOrderDate({ orderCount: 1, totalGross: 1, lastOrderAt: '2027-02-06T10:00:00Z' }),
    ).toBe('06/02/2027')
    // 20:00 UTC is already the next day in Vietnam
    expect(
      lastOrderDate({ orderCount: 1, totalGross: 1, lastOrderAt: '2027-02-06T20:00:00Z' }),
    ).toBe('07/02/2027')
    expect(lastOrderDate(undefined)).toBe('')
  })
})
