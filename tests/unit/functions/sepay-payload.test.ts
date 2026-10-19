import { describe, expect, it } from 'vitest'
import { hasRepresentableId } from '../../../supabase/functions/_shared/sepay-payload'

describe('hasRepresentableId', () => {
  it('accepts safe integers, digit strings and non-numeric ids (the database validates those)', () => {
    expect(hasRepresentableId({ id: 92704 })).toBe(true)
    expect(hasRepresentableId({ id: Number.MAX_SAFE_INTEGER })).toBe(true)
    expect(hasRepresentableId({ id: '9007199254740993' })).toBe(true)
    expect(hasRepresentableId({ id: 'abc' })).toBe(true)
    expect(hasRepresentableId({})).toBe(true)
  })

  it('refuses a numeric id that JSON.parse may have rounded', () => {
    const parsed = JSON.parse('{"id":9007199254740993}') as Record<string, unknown>
    expect(hasRepresentableId(parsed)).toBe(false)
    expect(hasRepresentableId({ id: 1.5 })).toBe(false)
    expect(hasRepresentableId({ id: 1e30 })).toBe(false)
  })
})
