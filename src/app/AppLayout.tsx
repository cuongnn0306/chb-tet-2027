import { NavLink, Outlet } from 'react-router'
import { Button } from '@/components/ui/Button'
import { hasPermission, type RoleCode } from '@/domain/auth/roles'
import { BATCH_VIEW_ROLES, LEDGER_VIEW_ROLES } from '@/domain/inventory/movements'
import { useAuth } from '@/features/auth/auth-context'
import { PermissionGate } from '@/features/auth/PermissionGate'
import { ADMIN_NAV, ROUTES } from './routes'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-md px-3 py-2 text-sm ${
    isActive ? 'bg-green-100 font-medium text-green-900' : 'text-slate-700 hover:bg-slate-100'
  }`

interface MainNavItem {
  to: string
  label: string
  visible: (role: RoleCode) => boolean
}

/** Main navigation: what each role gets to see (the screens and the database enforce it too). */
const MAIN_NAV: MainNavItem[] = [
  { to: ROUTES.orders, label: 'Đơn hàng', visible: (role) => hasPermission(role, 'create_order') },
  {
    to: ROUTES.customers,
    label: 'Khách hàng',
    visible: (role) => hasPermission(role, 'create_order'),
  },
  { to: ROUTES.inventory, label: 'Tồn kho', visible: () => true },
  {
    to: ROUTES.inventoryBatches,
    label: 'Tồn theo lô',
    visible: (role) => (BATCH_VIEW_ROLES as readonly string[]).includes(role),
  },
  {
    to: ROUTES.inventoryMovements,
    label: 'Lịch sử kho',
    visible: (role) => (LEDGER_VIEW_ROLES as readonly string[]).includes(role),
  },
  { to: ROUTES.inventoryImport, label: 'Nhập tồn đầu kỳ', visible: (role) => role === 'ADMIN' },
  { to: ROUTES.paymentReview, label: 'Thanh toán cần xử lý', visible: (role) => role === 'ADMIN' },
]

export function AppLayout() {
  const { access, signOut } = useAuth()
  const user = access.status === 'active' ? access.user : null
  const mainNav = user ? MAIN_NAV.filter((item) => item.visible(user.roleCode)) : []

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <NavLink to={ROUTES.home} className="font-semibold text-green-800">
            CHB Bánh chưng Tết 2027
          </NavLink>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{user?.fullName}</span>
            <Button variant="secondary" onClick={() => void signOut()}>
              Đăng xuất
            </Button>
          </div>
        </div>
        {mainNav.length > 0 ? (
          <nav
            aria-label="Chức năng chính"
            className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-1"
          >
            {mainNav.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
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
