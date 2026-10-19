import { Button } from '@/components/ui/Button'
import { useAuth } from '../auth-context'

const COPY = {
  inactive: {
    title: 'Tài khoản đã bị vô hiệu hóa',
    body: 'Bạn không còn quyền sử dụng hệ thống. Vui lòng liên hệ quản trị viên nếu đây là nhầm lẫn.',
  },
  no_profile: {
    title: 'Tài khoản chưa được cấp quyền',
    body: 'Tài khoản của bạn chưa được thiết lập vai trò. Vui lòng liên hệ quản trị viên.',
  },
} as const

export function BlockedAccountPage({ reason }: { reason: keyof typeof COPY }) {
  const { signOut } = useAuth()
  const { title, body } = COPY[reason]
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
      <p className="text-slate-600">{body}</p>
      <Button variant="secondary" onClick={() => void signOut()}>
        Đăng xuất
      </Button>
    </main>
  )
}
