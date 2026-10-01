import { execSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Integration tests run against LOCAL Supabase only.
 * Connection values come from SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY,
 * otherwise from `npx supabase status -o env` of the running local stack.
 */
export interface LocalSupabaseConfig {
  url: string
  anonKey: string
  serviceRoleKey: string
}

let cached: LocalSupabaseConfig | undefined

export function getLocalConfig(): LocalSupabaseConfig {
  if (cached) return cached
  let url = process.env.SUPABASE_URL
  let anonKey = process.env.SUPABASE_ANON_KEY
  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceRoleKey) {
    const raw = execSync('npx supabase status -o env', { encoding: 'utf8' })
    const values = Object.fromEntries(
      raw
        .split(/\r?\n/)
        .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => [m[1], m[2]]),
    )
    url ??= values.API_URL
    anonKey ??= values.ANON_KEY
    serviceRoleKey ??= values.SERVICE_ROLE_KEY
  }
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error('Không đọc được cấu hình Supabase local. Chạy `npx supabase start` trước.')
  }
  const host = new URL(url).hostname
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
    throw new Error(`Từ chối chạy integration test trên Supabase không phải local (${host}).`)
  }
  cached = { url, anonKey, serviceRoleKey }
  return cached
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } }

/** Bypasses RLS. Only for test setup/teardown and assertions about stored data. */
export function serviceClient(): SupabaseClient {
  const { url, serviceRoleKey } = getLocalConfig()
  return createClient(url, serviceRoleKey, clientOptions)
}

export function anonClient(): SupabaseClient {
  const { url, anonKey } = getLocalConfig()
  return createClient(url, anonKey, clientOptions)
}
