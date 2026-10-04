import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ROUTES } from '@/app/routes'
import { DateTimeText } from '@/components/shared/MoneyText'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import type { TransferStatus } from '@/domain/transfers/transfers'
import { useAuth } from '@/features/auth/auth-context'
import { TransferStatusBadge } from '../components/TransferStatusBadge'
import { useTransferService } from '../hooks/useTransferService'

/** What the status means for stock, in plain Vietnamese (a request alone never changes stock). */
const STATUS_EXPLANATION: Record<TransferStatus, string> = {
  REQUESTED:
    'Đang chờ Admin xem xét. Hàng chưa được giữ và chưa bị trừ khỏi kho xuất; tồn kho hai bên chưa thay đổi.',
  APPROVED: 'Admin đã duyệt. Hàng chỉ rời kho xuất khi kho xác nhận xuất.',
  REJECTED: 'Yêu cầu bị từ chối. Tồn kho không thay đổi.',
  DISPATCHED: 'Hàng đã rời kho xuất và đang trên đường tới kho nhận.',
  RECEIVED: 'Kho nhận đã nhận hàng.',
  CANCELLED: 'Yêu cầu đã hủy. Tồn kho không thay đổi.',
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-sm text-slate-600 sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  )
}

/** One transfer request: the Admin and the requester can read it (RLS decides who sees what). */
export function TransferDetailPage() {
  const { transferId = '' } = useParams()
  const [search] = useSearchParams()
  const service = useTransferService()
  const { access } = useAuth()
  const isAdmin = access.status === 'active' && access.user.roleCode === 'ADMIN'

  const transfer = useQuery({
    queryKey: ['transfers', 'detail', transferId],
    queryFn: () => service.get(transferId),
    enabled: transferId !== '',
  })

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <Link to={ROUTES.transfers} className="text-sm text-green-800 underline">
        ← Danh sách yêu cầu
      </Link>

      {transfer.isPending ? <LoadingState /> : null}
      {transfer.isError ? (
        <ErrorState
          title="Không tải được yêu cầu điều chuyển"
          action={{ label: 'Thử lại', onClick: () => void transfer.refetch() }}
        >
          Vui lòng kiểm tra kết nối mạng rồi thử lại.
        </ErrorState>
      ) : null}
      {transfer.isSuccess && transfer.data === null ? (
        <EmptyState title="Không tìm thấy yêu cầu điều chuyển">
          Yêu cầu không tồn tại, hoặc bạn không có quyền xem yêu cầu này. Chỉ Admin và người gửi yêu
          cầu xem được chi tiết.
        </EmptyState>
      ) : null}

      {transfer.data ? (
        <>
          {search.get('created') === '1' ? (
            <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
              Đã gửi yêu cầu {transfer.data.transfer_code}. Tồn kho chưa thay đổi; Admin sẽ xem xét
              yêu cầu.
            </p>
          ) : null}

          <header className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="font-mono text-xl font-semibold text-slate-900">
              {transfer.data.transfer_code}
            </h1>
            <TransferStatusBadge status={transfer.data.status} />
          </header>
          <p className="text-sm text-slate-700">{STATUS_EXPLANATION[transfer.data.status]}</p>

          <dl className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <Row label="Kho xuất">
              {transfer.data.source ? (
                <>
                  <span className="font-mono">{transfer.data.source.code}</span> —{' '}
                  {transfer.data.source.name}
                </>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Kho nhận">
              {transfer.data.destination ? (
                <>
                  <span className="font-mono">{transfer.data.destination.code}</span> —{' '}
                  {transfer.data.destination.name}
                </>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Người yêu cầu">{transfer.data.requester?.full_name ?? '—'}</Row>
            <Row label="Gửi lúc">
              <DateTimeText value={transfer.data.created_at} />
            </Row>
            {transfer.data.approved_at ? (
              <Row label="Duyệt lúc">
                <DateTimeText value={transfer.data.approved_at} />
              </Row>
            ) : null}
            {transfer.data.dispatched_at ? (
              <Row label="Xuất kho lúc">
                <DateTimeText value={transfer.data.dispatched_at} />
              </Row>
            ) : null}
            {transfer.data.received_at ? (
              <Row label="Nhận hàng lúc">
                <DateTimeText value={transfer.data.received_at} />
              </Row>
            ) : null}
            <Row label="Lý do / ghi chú">
              <span className="whitespace-pre-wrap">{transfer.data.reason}</span>
            </Row>
          </dl>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Sản phẩm</th>
                  <th className="px-3 py-2 text-right font-medium">Số lượng đề nghị</th>
                </tr>
              </thead>
              <tbody>
                {transfer.data.transfer_items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      {item.products ? (
                        <>
                          <span className="font-mono">{item.products.sku}</span> —{' '}
                          {item.products.name}
                        </>
                      ) : (
                        'Sản phẩm'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {item.requested_qty.toLocaleString('vi-VN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isAdmin && transfer.data.status === 'REQUESTED' ? (
            <p className="text-sm text-slate-600">
              Duyệt và từ chối yêu cầu chưa có trong phiên bản này; yêu cầu vẫn được lưu để xử lý
              sau.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
