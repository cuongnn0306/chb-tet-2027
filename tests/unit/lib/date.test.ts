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

describe('formatDateTime', () => {
  it('shows instants in Vietnam time (UTC+7) regardless of the viewer time zone', async () => {
    const { formatDateTime } = await import('@/lib/date')
    expect(formatDateTime('2027-02-06T07:30:00Z').replace(/\s+/g, ' ')).toBe('06/02/2027 14:30')
    expect(formatDateTime('2027-02-06T20:00:00Z').replace(/\s+/g, ' ')).toBe('07/02/2027 03:00')
  })

  it('returns unparseable input unchanged', async () => {
    const { formatDateTime } = await import('@/lib/date')
    expect(formatDateTime('not a date')).toBe('not a date')
  })
})
