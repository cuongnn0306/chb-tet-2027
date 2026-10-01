import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ROUTES } from '@/app/routes'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { SIGN_IN_FAILURE_MESSAGES } from '@/domain/auth/sign-in'
import { useAuth } from '../auth-context'

export function LoginPage() {
  const { access, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from ?? ROUTES.home

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (access.status === 'active') return <Navigate to={redirectTo} replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const result = await signIn(email, password)
    setSubmitting(false)
    if (result.ok) {
      void navigate(redirectTo, { replace: true })
    } else {
      setError(SIGN_IN_FAILURE_MESSAGES[result.reason])
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <header className="text-center">
        <p className="text-sm font-semibold tracking-wide text-green-800">CHB FOOD</p>
        <h1 className="text-2xl font-bold text-slate-900">Bánh chưng Tết 2027</h1>
      </header>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Mật khẩu"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={submitting} disabled={!email || !password}>
          {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </Button>
      </form>
    </main>
  )
}
