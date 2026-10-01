import { Outlet } from 'react-router'
import { NoPermissionState } from '@/components/shared/PageState'
import type { RoleCode } from '@/domain/auth/roles'
import { useAuth } from '@/features/auth/auth-context'

/**
 * Route wrapper for screens limited to specific roles that are not a matrix permission
 * (e.g. batch-level stock for Admin/Warehouse/Production). The database enforces the same rule.
 */
export function RoleRoute({ roles }: { roles: readonly RoleCode[] }) {
  const { access } = useAuth()
  if (access.status !== 'active' || !roles.includes(access.user.roleCode))
    return <NoPermissionState />
  return <Outlet />
}
