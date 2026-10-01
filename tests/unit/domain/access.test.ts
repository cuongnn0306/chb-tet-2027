import { describe, expect, it } from 'vitest'
import { resolveAccess, type AuthSnapshot, type CurrentProfile } from '@/domain/auth/access'

const profile: CurrentProfile = {
  id: 'u1',
  fullName: 'Nguyễn Văn A',
  isActive: true,
  roleCode: 'STORE_STAFF',
  roleName: 'Nhân viên cửa hàng CHB',
  defaultLocationId: 'l1',
  defaultSalesChannelId: 'c1',
  defaultLeadSourceId: 's1',
}

const base: AuthSnapshot = { sessionLoaded: true, userId: 'u1', profileLoaded: true, profile }

describe('resolveAccess', () => {
  it('is loading until the session is read', () => {
    expect(resolveAccess({ ...base, sessionLoaded: false }).status).toBe('loading')
  })

  it('is signed_out without a session', () => {
    expect(
      resolveAccess({ ...base, userId: null, profile: null, profileLoaded: false }).status,
    ).toBe('signed_out')
  })

  it('is loading while the profile loads', () => {
    expect(resolveAccess({ ...base, profileLoaded: false, profile: null }).status).toBe('loading')
  })

  it('denies a signed-in user without a profile', () => {
    expect(resolveAccess({ ...base, profile: null }).status).toBe('no_profile')
  })

  it('blocks an inactive user even if the role is unreadable', () => {
    const state = resolveAccess({
      ...base,
      profile: { ...profile, isActive: false, roleCode: null },
    })
    expect(state).toEqual({ status: 'inactive', fullName: 'Nguyễn Văn A' })
  })

  it('fails closed on an unknown or missing role', () => {
    expect(resolveAccess({ ...base, profile: { ...profile, roleCode: 'HACKER' } }).status).toBe(
      'no_profile',
    )
    expect(resolveAccess({ ...base, profile: { ...profile, roleCode: null } }).status).toBe(
      'no_profile',
    )
  })

  it('grants access to an active user with a valid role', () => {
    const state = resolveAccess(base)
    expect(state.status).toBe('active')
    if (state.status === 'active') expect(state.user.roleCode).toBe('STORE_STAFF')
  })
})
