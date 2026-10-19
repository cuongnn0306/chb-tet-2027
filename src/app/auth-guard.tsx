import { Navigate, Outlet, useLocation } from 'react-router'
import { LoadingState } from '@/components/shared/PageState'
import { useAuth } from '@/features/auth/auth-context'
import { BlockedAccountPage } from '@/features/auth/pages/BlockedAccountPage'
import { ROUTES } from './routes'

/** Renders child routes only for an active, permitted user. */
export function AuthGuard() {
  const { access } = useAuth()
  const location = useLocation()

  switch (access.status) {
    case 'loading':
      return <LoadingState label="Đang kiểm tra phiên đăng nhập…" />
    case 'signed_out':
      return <Navigate to={ROUTES.login} replace state={{ from: location.pathname }} />
    case 'inactive':
    case 'no_profile':
      return <BlockedAccountPage reason={access.status} />
    case 'active':
      return <Outlet />
  }
}
