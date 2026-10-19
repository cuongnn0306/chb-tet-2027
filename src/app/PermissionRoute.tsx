import { Outlet } from 'react-router'
import type { Permission } from '@/domain/auth/roles'
import { PermissionGate } from '@/features/auth/PermissionGate'

/** Route wrapper: child routes render only for roles holding `permission` (the database enforces it too). */
export function PermissionRoute({ permission }: { permission: Permission }) {
  return (
    <PermissionGate permission={permission}>
      <Outlet />
    </PermissionGate>
  )
}
