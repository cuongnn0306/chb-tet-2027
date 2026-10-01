import { NavLink, Outlet } from 'react-router'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/auth-context'
import { PermissionGate } from '@/features/auth/PermissionGate'
import { ADMIN_NAV, ROUTES } from './routes'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-md px-3 py-2 text-sm ${
    isActive ? 'bg-green-100 font-medium text-green-900' : 'text-slate-700 hover:bg-slate-100'
  }`

export function AppLayout() {
  const { access, signOut } = useAuth()
  const name = access.status === 'active' ? access.user.fullName : ''
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <NavLink to={ROUTES.home} className="font-semibold text-green-800">
            CHB Bánh chưng Tết 2027
          </NavLink>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{name}</span>
            <Button variant="secondary" onClick={() => void signOut()}>
              Đăng xuất
            </Button>
          </div>
        </div>
        <PermissionGate permission="manage_master_data" hideWhenDenied>
          <nav
            aria-label="Danh mục"
            className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-1"
          >
            <span className="self-center px-2 text-xs font-semibold uppercase text-slate-500">
              Danh mục
            </span>
            {ADMIN_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </PermissionGate>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  )
}
