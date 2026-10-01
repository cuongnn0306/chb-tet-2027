import { describe, expect, it } from 'vitest'
import { parseClientEnv, requireSupabaseEnv } from '@/lib/env'

describe('parseClientEnv', () => {
  it('defaults to local', () => {
    expect(parseClientEnv({}).appEnv).toBe('local')
  })

  it('accepts the three known environments', () => {
    for (const name of ['local', 'staging', 'production']) {
      expect(parseClientEnv({ VITE_APP_ENV: name }).appEnv).toBe(name)
    }
  })

  it('rejects unknown environments', () => {
    expect(() => parseClientEnv({ VITE_APP_ENV: 'prod' })).toThrow(/VITE_APP_ENV/)
  })
})

describe('requireSupabaseEnv', () => {
  it('throws when Supabase settings are missing', () => {
    expect(() => requireSupabaseEnv(parseClientEnv({}))).toThrow(/VITE_SUPABASE_URL/)
  })

  it('returns url and key when present', () => {
    const env = parseClientEnv({ VITE_SUPABASE_URL: 'http://x', VITE_SUPABASE_ANON_KEY: 'k' })
    expect(requireSupabaseEnv(env)).toEqual({ url: 'http://x', anonKey: 'k' })
  })
})
