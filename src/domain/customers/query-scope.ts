import type { AccessState } from '@/domain/auth/access'

/** Customer RLS depends on both identity and role; never share cached rows across these scopes. */
export function customerQueryScope(access: AccessState): string | null {
  return access.status === 'active' ? JSON.stringify([access.user.id, access.user.roleCode]) : null
}
