import { createClient } from '@supabase/supabase-js'
import { appEnv, requireSupabaseEnv } from '@/lib/env'

/**
 * Browser Supabase client (anon key + RLS only).
 * Inventory balances, payments and state transitions must go through RPC, never direct writes.
 */
export function createBrowserClient() {
  const { url, anonKey } = requireSupabaseEnv(appEnv)
  return createClient(url, anonKey)
}
