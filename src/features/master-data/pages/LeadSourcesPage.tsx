import { LookupAdminPage } from '../components/LookupAdminPage'

export function LeadSourcesPage() {
  return (
    <LookupAdminPage
      table="lead_sources"
      title="Nguồn khách"
      description="Facebook, TikTok, Zalo, Hotline, Walk-in…"
      noun="nguồn khách"
      deactivationWarning="Nguồn khách sẽ không còn được chọn khi tạo đơn mới. Các đơn cũ vẫn giữ nguyên và thao tác được lưu Audit Log."
    />
  )
}
