import { Outlet } from 'react-router'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/auth-context'

export function AppLayout() {
  const { access, signOut } = useAuth()
  const name = access.status === 'active' ? access.user.fullName : ''
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <span className="font-semibold text-green-800">CHB Bánh chưng Tết 2027</span>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-slate-600 sm:inline">{name}</span>
          <Button variant="secondary" onClick={() => void signOut()}>
            Đăng xuất
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  )
}
