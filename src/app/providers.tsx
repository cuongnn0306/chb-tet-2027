import { useMemo, type ReactNode } from 'react'
import { ErrorState } from '@/components/shared/PageState'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { getSupabase } from '@/lib/supabase'
import { createAuthService } from '@/services/auth.service'

export function Providers({ children }: { children: ReactNode }) {
  const service = useMemo(() => {
    try {
      return createAuthService(getSupabase())
    } catch (error) {
      console.error('Cấu hình Supabase không hợp lệ', error)
      return null
    }
  }, [])

  if (!service) {
    // Do not expose internal configuration details to end users.
    return (
      <div className="p-6">
        <ErrorState title="Ứng dụng chưa được cấu hình">
          Vui lòng liên hệ quản trị viên để được hỗ trợ.
        </ErrorState>
      </div>
    )
  }
  return <AuthProvider service={service}>{children}</AuthProvider>
}
