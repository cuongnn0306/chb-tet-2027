import { LookupAdminPage } from '../components/LookupAdminPage'

export function SalesChannelsPage() {
  return (
    <LookupAdminPage
      table="sales_channels"
      title="Kênh bán"
      description="Cửa hàng trực thuộc, Franchise, Online, B2B, CTV…"
      noun="kênh bán"
      deactivationWarning="Kênh bán sẽ không còn được chọn khi tạo đơn mới. Các đơn cũ vẫn giữ nguyên và thao tác được lưu Audit Log."
    />
  )
}
