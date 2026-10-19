import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { AppSupabaseClient } from '@/lib/supabase'
import { createAuthService } from '@/services/auth.service'
import type { Database } from '@/types/database.generated'
import { TEST_PASSWORD, TEST_USERS, getLocalConfig, serviceClient } from './helpers'

function newService() {
  const { url, anonKey } = getLocalConfig()
  const client: AppSupabaseClient = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return { client, service: createAuthService(client) }
}

describe('auth service sign-in (AUTH-001)', () => {
  it('signs in an active user and returns their profile with role and defaults', async () => {
    const { service } = newService()
    const result = await service.signIn(TEST_USERS.store, TEST_PASSWORD)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.profile).toMatchObject({
        fullName: 'Nhân viên cửa hàng Test',
        isActive: true,
        roleCode: 'STORE_STAFF',
      })
      expect(result.profile.defaultLocationId).not.toBeNull()
      expect(result.profile.defaultSalesChannelId).not.toBeNull()
      expect(result.profile.defaultLeadSourceId).not.toBeNull()
    }
  })

  it('rejects wrong credentials without revealing which part was wrong', async () => {
    const { service } = newService()
    const wrongPassword = await service.signIn(TEST_USERS.store, 'sai-mat-khau')
    const unknownUser = await service.signIn('khong-ton-tai@chb-test.local', TEST_PASSWORD)
    expect(wrongPassword).toEqual({ ok: false, reason: 'invalid_credentials' })
    expect(unknownUser).toEqual({ ok: false, reason: 'invalid_credentials' })
  })

  it('blocks and signs out an inactive user', async () => {
    const { client, service } = newService()
    expect(await service.signIn(TEST_USERS.inactive, TEST_PASSWORD)).toEqual({
      ok: false,
      reason: 'inactive',
    })
    const { data } = await client.auth.getSession()
    expect(data.session).toBeNull()
  })

  it('blocks and signs out a user without a profile (fail closed)', async () => {
    const email = `noprofile-${randomUUID()}@chb-test.local`
    const { error } = await serviceClient().auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    expect(error).toBeNull()

    const { client, service } = newService()
    expect(await service.signIn(email, TEST_PASSWORD)).toEqual({ ok: false, reason: 'no_profile' })
    expect((await client.auth.getSession()).data.session).toBeNull()
  })

  it('reports a restored session user id and clears it on sign-out', async () => {
    const { service } = newService()
    await service.signIn(TEST_USERS.sale, TEST_PASSWORD)
    expect(await service.getSessionUserId()).not.toBeNull()
    await service.signOut()
    expect(await service.getSessionUserId()).toBeNull()
  })

  it('shows an inactive profile as inactive when restored from a session', async () => {
    // Simulates a user deactivated while already signed in: profile is readable, role is not.
    const { client, service } = newService()
    const svc = serviceClient()
    const email = `deactivate-${randomUUID()}@chb-test.local`
    const created = await svc.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      app_metadata: { role_code: 'STORE_STAFF' },
      user_metadata: { full_name: 'Sắp bị khóa' },
    })
    const id = created.data.user?.id as string
    expect((await service.signIn(email, TEST_PASSWORD)).ok).toBe(true)

    await svc.from('profiles').update({ is_active: false }).eq('id', id)
    const profile = await service.loadCurrentProfile(id)
    expect(profile).toMatchObject({ isActive: false, roleCode: null })
    await client.auth.signOut()
  })
})
