import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { ROUTES } from '@/app/routes'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import { DateTimeText, MoneyText } from '@/components/shared/MoneyText'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import { customerDisplayName } from '@/domain/customers/validation'
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from '@/domain/orders/state-machine'
import { useAuth } from '@/features/auth/auth-context'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { ORDER_PAGE_SIZE } from '@/services/orders.service'
import { OrderStatusBadge } from '../components/OrderStatusBadge'
import { useOrderService } from '../hooks/useOrderService'

export function OrderListPage() {
  const service = useOrderService()
  const { access } = useAuth()
  const isAdmin = access.status === 'active' && access.user.roleCode === 'ADMIN'

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'' | OrderStatus>('')
  const [page, setPage] = useState(0)
  const debouncedSearch = useDebouncedValue(search)

  const list = useQuery({
    queryKey: ['orders', debouncedSearch, status, page],
    queryFn: () => service.list({ query: debouncedSearch, status, page }),
    placeholderData: (previous) => previous,
  })

  const rows = list.data ?? []
  const visible = rows.slice(0, ORDER_PAGE_SIZE)
  const hasNext = rows.length > ORDER_PAGE_SIZE

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            {isAdmin ? 'Tất cả đơn hàng' : 'Đơn hàng của tôi'}
          </h1>
          <p className="text-sm text-slate-600">Tìm theo mã đơn, tên khách hoặc số điện thoại.</p>
        </div>
        <Link
          to={ROUTES.orderNew}
          className="inline-flex min-h-11 items-center rounded-md bg-green-700 px-4 py-2 font-medium text-white hover:bg-green-800"
        >
          + Tạo đơn
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
        <TextField
          label="Tìm đơn hàng"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
          placeholder="Ví dụ: TET000123, Nguyễn A, 0901…"
        />
        <SelectField
          label="Trạng thái"
          placeholder="Tất cả"
          options={ORDER_STATUSES.map((value) => ({ value, label: ORDER_STATUS_LABELS[value] }))}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as '' | OrderStatus)
            setPage(0)
          }}
        />
      </div>

      {list.isPending ? <LoadingState /> : null}
      {list.isError ? (
        <ErrorState
          title="Không tải được danh sách đơn hàng"
          action={{ label: 'Thử lại', onClick: () => void list.refetch() }}
        >
          Vui lòng kiểm tra kết nối mạng rồi thử lại.
        </ErrorState>
      ) : null}
      {list.isSuccess && visible.length === 0 ? (
        <EmptyState
          title={
            debouncedSearch || status ? 'Không tìm thấy đơn hàng phù hợp' : 'Chưa có đơn hàng nào'
          }
        />
      ) : null}

      {visible.length > 0 ? (
        <>
          {/* Cards on phones, table from sm up (PRD: mobile-first for sales/store users). */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {visible.map((order) => (
              <li key={order.id}>
                <Link
                  to={ROUTES.orderDetail(order.id)}
                  className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium text-slate-900">{order.order_code}</span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <span className="text-slate-800">
                    {order.customers ? customerDisplayName(order.customers) : '—'}
                  </span>
                  <div className="flex items-center justify-between text-sm text-slate-600">
                    <MoneyText amount={order.net_amount} className="font-medium text-slate-900" />
                    <DateTimeText value={order.created_at} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Mã đơn</th>
                  <th className="px-3 py-2 font-medium">Khách hàng</th>
                  {isAdmin ? <th className="px-3 py-2 font-medium">Người phụ trách</th> : null}
                  <th className="px-3 py-2 text-right font-medium">Thực thu</th>
                  <th className="px-3 py-2 text-right font-medium">Còn lại</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                  <th className="px-3 py-2 font-medium">Ngày tạo</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => (
                  <tr key={order.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Link
                        to={ROUTES.orderDetail(order.id)}
                        className="font-mono font-medium text-green-800 underline"
                      >
                        {order.order_code}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {order.customers ? customerDisplayName(order.customers) : '—'}
                      {order.customers?.phone ? (
                        <span className="block font-mono text-xs text-slate-500">
                          {order.customers.phone}
                        </span>
                      ) : null}
                    </td>
                    {isAdmin ? <td className="px-3 py-2">{order.owner?.full_name ?? ''}</td> : null}
                    <td className="px-3 py-2 text-right">
                      <MoneyText amount={order.net_amount} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <MoneyText amount={order.remaining_amount} />
                    </td>
                    <td className="px-3 py-2">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="px-3 py-2">
                      <DateTimeText value={order.created_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {page > 0 || hasNext ? (
        <div className="flex items-center justify-between">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Trang trước
          </Button>
          <span className="text-sm text-slate-600">Trang {page + 1}</span>
          <Button variant="secondary" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
            Trang sau
          </Button>
        </div>
      ) : null}
    </section>
  )
}
