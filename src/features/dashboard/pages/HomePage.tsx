import { useAuth } from '@/features/auth/auth-context'

/** Placeholder landing page until the dashboards of later epics exist. */
export function HomePage() {
  const { access } = useAuth()
  if (access.status !== 'active') return null
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold text-slate-900">Xin chào, {access.user.fullName}</h1>
      <p className="text-slate-600">Vai trò: {access.user.roleName ?? access.user.roleCode}</p>
    </section>
  )
}
