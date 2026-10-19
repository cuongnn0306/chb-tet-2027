import { describe, expect, it } from 'vitest'
import { SIGN_IN_FAILURE_MESSAGES, classifyAuthError } from '@/domain/auth/sign-in'

describe('classifyAuthError', () => {
  it('maps known Supabase auth errors', () => {
    expect(classifyAuthError({ code: 'invalid_credentials', status: 400 })).toBe(
      'invalid_credentials',
    )
    expect(classifyAuthError({ code: 'over_request_rate_limit', status: 429 })).toBe('rate_limited')
    expect(classifyAuthError({ status: 429 })).toBe('rate_limited')
    expect(classifyAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toBe('network')
    expect(classifyAuthError({ code: 'something_else' })).toBe('unknown')
  })

  it('has a Vietnamese message for every failure and never leaks internals', () => {
    for (const message of Object.values(SIGN_IN_FAILURE_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10)
      expect(message).not.toMatch(/supabase|postgres|jwt|token/i)
    }
  })
})
