/**
 * Browser-safe environment parsing. Only VITE_* variables reach the client bundle,
 * so server secrets must never be read here (see .env.example).
 */
export const APP_ENVIRONMENTS = ['local', 'staging', 'production'] as const
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number]

export interface ClientEnv {
  appEnv: AppEnvironment
  supabaseUrl: string
  supabaseAnonKey: string
}

type RawEnv = Record<string, string | undefined>

export function parseClientEnv(raw: RawEnv): ClientEnv {
  const appEnv = raw.VITE_APP_ENV ?? 'local'
  if (!(APP_ENVIRONMENTS as readonly string[]).includes(appEnv)) {
    throw new Error(
      `VITE_APP_ENV không hợp lệ: "${appEnv}" (cho phép: ${APP_ENVIRONMENTS.join(', ')})`,
    )
  }
  return {
    appEnv: appEnv as AppEnvironment,
    supabaseUrl: raw.VITE_SUPABASE_URL?.trim() ?? '',
    supabaseAnonKey: raw.VITE_SUPABASE_ANON_KEY?.trim() ?? '',
  }
}

/** Throws if Supabase settings are missing; call where a backend connection is required. */
export function requireSupabaseEnv(env: ClientEnv): { url: string; anonKey: string } {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error('Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY. Xem .env.example.')
  }
  return { url: env.supabaseUrl, anonKey: env.supabaseAnonKey }
}

export const appEnv: ClientEnv = parseClientEnv(import.meta.env)
