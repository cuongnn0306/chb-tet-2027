import { useAuth } from '@/features/auth/auth-context'
import { LoadingState, NoPermissionState } from '@/components/shared/PageState'
import { LookupAdminPage } from '../components/LookupAdminPage'

export function SalesChannelsPage() {
  const { access } = useAuth()
  if (access.status === 'loading') return <LoadingState />
  if (access.status !== 'active' || access.user.roleCode !== 'ADMIN') return <NoPermissionState />
  return <SalesChannelsContent key={access.user.id} accountId={access.user.id} />
}
function SalesChannelsContent({ accountId }: { accountId: string }) {
  return (
    <LookupAdminPage
      table="sales_channels"
      cacheKey={JSON.stringify(['sales_channels', accountId])}
      title="Kênh bán"
      description="Cửa hàng trực thuộc, Franchise, Online, B2B, CTV…"
      noun="kênh bán"
      deactivationWarning="Kênh bán sẽ không còn được chọn khi tạo đơn mới. Các đơn cũ vẫn giữ nguyên và thao tác được lưu Audit Log."
    />
  )
}
