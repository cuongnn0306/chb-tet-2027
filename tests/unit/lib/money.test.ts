import { describe, expect, it } from 'vitest'
import { formatVnd, parseVnd } from '@/lib/money'

describe('formatVnd', () => {
  it('formats integer VND with Vietnamese grouping', () => {
    expect(formatVnd(1200000).replace(/\s/g, ' ')).toBe('1.200.000 ₫')
    expect(formatVnd(0).replace(/\s/g, ' ')).toBe('0 ₫')
  })
})

describe('parseVnd', () => {
  it('parses plain and grouped integers', () => {
    expect(parseVnd('1200000').value).toBe(1200000)
    expect(parseVnd('1.200.000').value).toBe(1200000)
    expect(parseVnd('1,200,000').value).toBe(1200000)
    expect(parseVnd(' 950 000 ').value).toBe(950000)
    expect(parseVnd('0').value).toBe(0)
  })

  it('rejects fractions, text, negatives, blanks and unsafe values', () => {
    for (const bad of ['12.5', '1.20', '1.2000.000', 'abc', '-5', '', '9'.repeat(20)]) {
      expect(parseVnd(bad).error).not.toBeNull()
    }
  })
})
