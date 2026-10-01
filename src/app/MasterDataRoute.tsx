import { Outlet } from 'react-router'
import { PermissionGate } from '@/features/auth/PermissionGate'

/** Master-data screens: Admin only (the database enforces it too). */
export function MasterDataRoute() {
  return (
    <PermissionGate permission="manage_master_data">
      <Outlet />
    </PermissionGate>
  )
}
