import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { ROUTES } from '@/app/routes'
import { DateTimeText } from '@/components/shared/MoneyText'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import { SelectField } from '@/components/ui/fields'
import {
  TRANSFER_STATUSES,
  TRANSFER_STATUS_LABELS,
  type TransferStatus,
} from '@/domain/transfers/transfers'
import { useAuth } from '@/features/auth/auth-context'
import { TRANSFER_LIST_LIMIT, type TransferDetail } from '@/services/transfers.service'
import { TransferStatusBadge } from '../components/TransferStatusBadge'
import { useTransferService } from '../hooks/useTransferService'

const createLinkClass =
  'inline-flex min-h-11 items-center rounded-md bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800'

function itemsSummary(transfer: TransferDetail): string {
  if (transfer.transfer_items.length === 0) return '—'
  return transfer.transfer_items
    .map(
      (item) =>
        `${item.products?.name ?? 'Sản phẩm'} × ${item.requested_qty.toLocaleString('vi-VN')}`,
    )
    .join(', ')
}

/** The Admin sees every request (the queue); everyone else sees the requests they sent (RLS decides). */
export function TransferListPage() {
  const service = useTransferService()
  const { access } = useAuth()
  const isAdmin = access.status === 'active' && access.user.roleCode === 'ADMIN'
  const [status, setStatus] = useState<'' | TransferStatus>('')

  const list = useQuery({
    queryKey: ['transfers', status],
    queryFn: () => service.list(status ? { status } : {}),
  })
  const rows = list.data ?? []

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {isAdmin ? 'Yêu cầu điều chuyển kho' : 'Yêu cầu điều chuyển của tôi'}
          </h1>
          <p className="text-sm text-slate-600">
            Yêu cầu chỉ ghi nhận nhu cầu chuyển hàng giữa các kho. Tồn kho chưa thay đổi cho đến khi
            hàng thực sự được chuyển.
          </p>
        </div>
        <Link to={ROUTES.transferNew} className={createLinkClass}>
          + Tạo yêu cầu
        </Link>
      </header>

      <div className="sm:max-w-xs">
        <SelectField
          label="Trạng thái"
          placeholder="Tất cả"
          options={TRANSFER_STATUSES.map((value) => ({
            value,
            label: TRANSFER_STATUS_LABELS[value],
          }))}
          value={status}
          onChange={(e) => setStatus(e.target.value as '' | TransferStatus)}
        />
      </div>

      {list.isPending ? <LoadingState /> : null}
      {list.isError ? (
        <ErrorState
          title="Không tải được danh sách yêu cầu"
          action={{ label: 'Thử lại', onClick: () => void list.refetch() }}
        >
          Vui lòng kiểm tra kết nối mạng rồi thử lại.
        </ErrorState>
      ) : null}
      {list.isSuccess && rows.length === 0 ? (
        <EmptyState
          title={
            status ? 'Không có yêu cầu nào ở trạng thái này' : 'Chưa có yêu cầu điều chuyển nào'
          }
        >
          {status
            ? 'Chọn "Tất cả" để xem mọi yêu cầu.'
            : 'Khi kho cần thêm hàng, bấm "Tạo yêu cầu" để gửi cho Admin.'}
        </EmptyState>
      ) : null}

      {rows.length > 0 ? (
        <>
          {/* Cards on phones, table from sm up (PRD: mobile-first for sales/store users). */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {rows.map((transfer) => (
              <li key={transfer.id}>
                <Link
                  to={ROUTES.transferDetail(transfer.id)}
                  className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium text-slate-900">
                      {transfer.transfer_code}
                    </span>
                    <TransferStatusBadge status={transfer.status} />
                  </div>
                  <span className="text-slate-800">
                    {transfer.source?.name ?? '—'} → {transfer.destination?.name ?? '—'}
                  </span>
                  <span className="text-sm text-slate-700">{itemsSummary(transfer)}</span>
                  <span className="text-sm text-slate-600">
                    {isAdmin ? `${transfer.requester?.full_name ?? ''} · ` : ''}
                    <DateTimeText value={transfer.created_at} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Mã</th>
                  <th className="px-3 py-2 font-medium">Kho xuất</th>
                  <th className="px-3 py-2 font-medium">Kho nhận</th>
                  <th className="px-3 py-2 font-medium">Sản phẩm</th>
                  {isAdmin ? <th className="px-3 py-2 font-medium">Người yêu cầu</th> : null}
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                  <th className="px-3 py-2 font-medium">Gửi lúc</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((transfer) => (
                  <tr key={transfer.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Link
                        to={ROUTES.transferDetail(transfer.id)}
                        className="font-mono font-medium text-green-800 underline"
                      >
                        {transfer.transfer_code}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{transfer.source?.name ?? '—'}</td>
                    <td className="px-3 py-2">{transfer.destination?.name ?? '—'}</td>
                    <td className="px-3 py-2">{itemsSummary(transfer)}</td>
                    {isAdmin ? (
                      <td className="px-3 py-2">{transfer.requester?.full_name ?? ''}</td>
                    ) : null}
                    <td className="px-3 py-2">
                      <TransferStatusBadge status={transfer.status} />
                    </td>
                    <td className="px-3 py-2">
                      <DateTimeText value={transfer.created_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length >= TRANSFER_LIST_LIMIT ? (
            <p className="text-sm text-slate-600">
              Đang hiển thị {TRANSFER_LIST_LIMIT} yêu cầu mới nhất. Lọc theo trạng thái để thu hẹp
              danh sách.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
