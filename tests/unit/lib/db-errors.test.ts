import { describe, expect, it } from 'vitest'
import { describeDbError } from '@/lib/db-errors'

describe('describeDbError', () => {
  it('explains duplicates and permission errors in Vietnamese', () => {
    expect(describeDbError({ code: '23505' })).toMatch(/đã tồn tại/)
    expect(describeDbError({ code: '42501' })).toMatch(/không có quyền/)
  })

  it('never leaks raw database messages', () => {
    const message = describeDbError({ code: 'XX000', message: 'relation "x" violates ...' })
    expect(message).not.toMatch(/relation|violates/)
  })
})
