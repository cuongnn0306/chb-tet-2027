import { describe, expect, it } from 'vitest'
import { formatDate } from '@/lib/date'

describe('formatDate', () => {
  it('formats YYYY-MM-DD as dd/MM/yyyy without time-zone shifts', () => {
    expect(formatDate('2027-02-06')).toBe('06/02/2027')
    expect(formatDate('2026-12-31')).toBe('31/12/2026')
  })

  it('returns unknown input unchanged', () => {
    expect(formatDate('')).toBe('')
    expect(formatDate('06/02/2027')).toBe('06/02/2027')
  })
})
