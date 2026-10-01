import { isRoleCode, type RoleCode } from '@/domain/auth/roles'

/** Profile of the signed-in user as the app needs it. `roleCode` is null when it cannot be read. */
export interface CurrentProfile {
  id: string
  fullName: string
  isActive: boolean
  roleCode: string | null
  roleName: string | null
  defaultLocationId: string | null
  defaultSalesChannelId: string | null
  defaultLeadSourceId: string | null
}

export interface ActiveUser extends CurrentProfile {
  roleCode: RoleCode
}

export interface AuthSnapshot {
  /** False until the stored session has been read once. */
  sessionLoaded: boolean
  userId: string | null
  /** False while the profile of `userId` is being loaded. */
  profileLoaded: boolean
  profile: CurrentProfile | null
}

export type AccessState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  /** Signed in, but no profile (or an unknown role): no access. */
  | { status: 'no_profile' }
  | { status: 'inactive'; fullName: string }
  | { status: 'active'; user: ActiveUser }

/** Decides what the app may show. Anything unclear fails closed. */
export function resolveAccess(snapshot: AuthSnapshot): AccessState {
  if (!snapshot.sessionLoaded) return { status: 'loading' }
  if (!snapshot.userId) return { status: 'signed_out' }
  if (!snapshot.profileLoaded) return { status: 'loading' }

  const { profile } = snapshot
  if (!profile) return { status: 'no_profile' }
  if (!profile.isActive) return { status: 'inactive', fullName: profile.fullName }
  if (!isRoleCode(profile.roleCode)) return { status: 'no_profile' }
  return { status: 'active', user: { ...profile, roleCode: profile.roleCode } }
}
