import type { ReactNode } from 'react'
import { NoPermissionState } from '@/components/shared/PageState'
import { hasPermission, type Permission } from '@/domain/auth/roles'
import { useAuth } from './auth-context'

interface Props {
  permission: Permission
  children: ReactNode
  /** Render nothing instead of the no-permission message. */
  hideWhenDenied?: boolean
}

/** UI convenience only. The database (RLS/RPC) is what actually enforces permissions. */
export function PermissionGate({ permission, children, hideWhenDenied = false }: Props) {
  const { access } = useAuth()
  const allowed = access.status === 'active' && hasPermission(access.user.roleCode, permission)
  if (allowed) return <>{children}</>
  return hideWhenDenied ? null : <NoPermissionState />
}
