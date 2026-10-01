import type { AuthChangeEvent } from '@supabase/supabase-js'
import type { CurrentProfile } from '@/domain/auth/access'
import { classifyAuthError, type SignInFailure } from '@/domain/auth/sign-in'
import type { AppSupabaseClient } from '@/lib/supabase'

export type SignInResult =
  { ok: true; profile: CurrentProfile } | { ok: false; reason: SignInFailure }

const PROFILE_COLUMNS =
  'id, full_name, is_active, default_location_id, default_sales_channel_id, default_lead_source_id, roles(code, name)'

/** Application service for authentication; takes the client so it can run in integration tests. */
export function createAuthService(client: AppSupabaseClient) {
  async function loadCurrentProfile(userId: string): Promise<CurrentProfile | null> {
    const { data, error } = await client
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle()
    if (error) throw new Error(`Không tải được hồ sơ người dùng: ${error.message}`)
    if (!data) return null
    return {
      id: data.id,
      fullName: data.full_name,
      isActive: data.is_active,
      // roles is unreadable (null) for an inactive user because RLS hides it: that is expected.
      roleCode: data.roles?.code ?? null,
      roleName: data.roles?.name ?? null,
      defaultLocationId: data.default_location_id,
      defaultSalesChannelId: data.default_sales_channel_id,
      defaultLeadSourceId: data.default_lead_source_id,
    }
  }

  return {
    loadCurrentProfile,

    async getSessionUserId(): Promise<string | null> {
      const { data } = await client.auth.getSession()
      return data.session?.user.id ?? null
    },

    /** Signs in and rejects (and signs out) accounts that must not enter: inactive or without profile. */
    async signIn(email: string, password: string): Promise<SignInResult> {
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error || !data.user)
        return { ok: false, reason: error ? classifyAuthError(error) : 'unknown' }

      let profile: CurrentProfile | null
      try {
        profile = await loadCurrentProfile(data.user.id)
      } catch {
        await client.auth.signOut()
        return { ok: false, reason: 'network' }
      }
      if (!profile) {
        await client.auth.signOut()
        return { ok: false, reason: 'no_profile' }
      }
      if (!profile.isActive) {
        await client.auth.signOut()
        return { ok: false, reason: 'inactive' }
      }
      return { ok: true, profile }
    },

    async signOut(): Promise<void> {
      await client.auth.signOut()
    },

    onAuthStateChange(callback: (event: AuthChangeEvent, userId: string | null) => void) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        callback(event, session?.user.id ?? null)
      })
      return () => data.subscription.unsubscribe()
    },
  }
}

export type AuthService = ReturnType<typeof createAuthService>
