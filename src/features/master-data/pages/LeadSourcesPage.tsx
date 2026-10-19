import { useAuth } from '@/features/auth/auth-context'
import { LoadingState, NoPermissionState } from '@/components/shared/PageState'
import { LookupAdminPage } from '../components/LookupAdminPage'

export function LeadSourcesPage() {
  const { access } = useAuth()
  if (access.status === 'loading') return <LoadingState />
  if (access.status !== 'active' || access.user.roleCode !== 'ADMIN') return <NoPermissionState />
  return <LeadSourcesContent key={access.user.id} accountId={access.user.id} />
}
function LeadSourcesContent({ accountId }: { accountId: string }) {
  return (
    <LookupAdminPage
      table="lead_sources"
      cacheKey={JSON.stringify(['lead_sources', accountId])}
      title="Nguồn khách"
      description="Facebook, TikTok, Zalo, Hotline, Walk-in…"
      noun="nguồn khách"
      deactivationWarning="Nguồn khách sẽ không còn được chọn khi tạo đơn mới. Các đơn cũ vẫn giữ nguyên và thao tác được lưu Audit Log."
    />
  )
}
