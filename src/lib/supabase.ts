import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { appEnv, requireSupabaseEnv } from '@/lib/env'
import type { Database } from '@/types/database.generated'

export type AppSupabaseClient = SupabaseClient<Database>

let client: AppSupabaseClient | undefined

/**
 * Browser Supabase client (anon key + RLS only), created once.
 * Inventory balances, payments and state transitions must go through RPC, never direct writes.
 * Throws when the Supabase environment variables are missing.
 */
export function getSupabase(): AppSupabaseClient {
  if (!client) {
    const { url, anonKey } = requireSupabaseEnv(appEnv)
    client = createClient<Database>(url, anonKey)
  }
  return client
}
