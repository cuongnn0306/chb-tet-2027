import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ROUTES } from '@/app/routes'
import { DateTimeText, MoneyText } from '@/components/shared/MoneyText'
import { ErrorState, LoadingState } from '@/components/shared/PageState'
import { customerDisplayName } from '@/domain/customers/validation'
import { availableActions, isEditable, type OrderAction } from '@/domain/orders/state-machine'
import { useAuth } from '@/features/auth/auth-context'
import { Button } from '@/components/ui/Button'
import { ACTION_COPY } from '../action-copy'
import { OrderActionDialog } from '../components/OrderActionDialog'
import { OrderPaymentPanel } from '@/features/payments/components/OrderPaymentPanel'
import { OrderStatusBadge } from '../components/OrderStatusBadge'
import { OrderStockPanel } from '../components/OrderStockPanel'
import { OrderTimeline } from '../components/OrderTimeline'
import { useOrderService } from '../hooks/useOrderService'

export function OrderDetailPage() {
  const { orderId = '' } = useParams()
  const service = useOrderService()
  const queryClient = useQueryClient()
  const { access } = useAuth()
  const isAdmin = access.status === 'active' && access.user.roleCode === 'ADMIN'
  const [action, setAction] = useState<OrderAction | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => service.get(orderId) })
  const history = useQuery({
    queryKey: ['order-history', orderId],
    queryFn: () => service.history(orderId),
  })

  if (order.isPending) return <LoadingState />
  if (order.isError) {
    return (
      <ErrorState
        title="Không tải được đơn hàng"
        action={{ label: 'Thử lại', onClick: () => void order.refetch() }}
      >
        Vui lòng kiểm tra kết nối mạng rồi thử lại.
      </ErrorState>
    )
  }
  const data = order.data
  if (!data) {
    return (
      <ErrorState title="Không tìm thấy đơn hàng">
        Đơn không tồn tại hoặc bạn không có quyền xem đơn này.
      </ErrorState>
    )
  }

  const actions = availableActions(data.status, isAdmin)
  const customer = data.customers
  const items = [...data.order_items].sort((a, b) =>
    (a.products?.sku ?? '').localeCompare(b.products?.sku ?? ''),
  )

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-slate-600">
            <Link className="underline" to={ROUTES.orders}>
              ← Đơn hàng
            </Link>
          </p>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-slate-900">
            <span className="font-mono">{data.order_code}</span>
            <OrderStatusBadge status={data.status} />
          </h1>
          <p className="text-sm text-slate-600">
            Tạo lúc <DateTimeText value={data.created_at} />
            {data.creator?.full_name ? ` bởi ${data.creator.full_name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {isEditable(data.status) ? (
            <Link
              to={ROUTES.orderEdit(data.id)}
              className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 text-slate-800 hover:bg-slate-50"
            >
              Sửa đơn nháp
            </Link>
          ) : null}
          <Link
            to={ROUTES.orderPrint(data.id)}
            className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 text-slate-800 hover:bg-slate-50"
          >
            In đơn
          </Link>
          {actions.map((a) => (
            <Button
              key={a}
              variant={a === 'submit' || a === 'confirm' ? 'primary' : 'secondary'}
              onClick={() => setAction(a)}
            >
              {ACTION_COPY[a].button}
            </Button>
          ))}
        </div>
      </header>

      {notice ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      ) : null}

      {!isEditable(data.status) && data.status !== 'CANCELLED' && data.status !== 'VOIDED' ? (
        <p className="rounded-md bg-blue-50 p-3 text-sm text-blue-900">
          Đơn đã gửi/xác nhận: không sửa được khách hàng, số lượng hay giá. Nếu khách thay đổi, hãy
          hủy đơn cũ và tạo đơn mới.
        </p>
      ) : null}
      {data.status === 'CANCELLED' && data.cancel_reason ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          Lý do hủy: {data.cancel_reason}
        </p>
      ) : null}
      {data.status === 'VOIDED' && data.void_reason ? (
        <p className="rounded-md bg-slate-100 p-3 text-sm text-slate-800">
          Lý do vô hiệu hóa: {data.void_reason}
        </p>
      ) : null}

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <h2 className="mb-1 font-semibold text-slate-900">Khách hàng</h2>
          {customer ? (
            <div className="text-sm text-slate-800">
              <p className="font-medium">{customerDisplayName(customer)}</p>
              {customer.phone ? <p className="font-mono">{customer.phone}</p> : null}
              {customer.customer_type === 'COMPANY' ? (
                <>
                  {customer.tax_code ? <p>MST: {customer.tax_code}</p> : null}
                  {customer.contact_name ? (
                    <p>
                      {customer.contact_name}
                      {customer.contact_title ? ` — ${customer.contact_title}` : ''}
                    </p>
                  ) : null}
                  {customer.email ? <p>{customer.email}</p> : null}
                  {customer.company_address ? <p>{customer.company_address}</p> : null}
                </>
              ) : customer.address ? (
                <p>{customer.address}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-600">—</p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-slate-600">Người phụ trách</dt>
          <dd>{data.owner?.full_name ?? '—'}</dd>
          <dt className="text-slate-600">Điểm tạo đơn</dt>
          <dd>{data.locations ? `${data.locations.code} — ${data.locations.name}` : '—'}</dd>
          <dt className="text-slate-600">Kênh bán</dt>
          <dd>{data.sales_channels?.name ?? '—'}</dd>
          <dt className="text-slate-600">Nguồn khách</dt>
          <dd>{data.lead_sources?.name ?? '—'}</dd>
          <dt className="text-slate-600">Hóa đơn</dt>
          <dd>{data.requires_invoice ? 'Cần xuất hóa đơn' : 'Không'}</dd>
        </dl>
        {data.notes ? (
          <p className="text-sm text-slate-800 sm:col-span-2">
            <span className="text-slate-600">Ghi chú: </span>
            {data.notes}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold text-slate-900">Sản phẩm</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="py-1 pr-3 font-medium">Sản phẩm</th>
                <th className="py-1 pr-3 text-right font-medium">SL</th>
                <th className="py-1 pr-3 text-right font-medium">Giá niêm yết</th>
                <th className="py-1 text-right font-medium">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3">
                    {item.products?.name ?? 'Sản phẩm'}
                    <span className="block font-mono text-xs text-slate-500">
                      {item.products?.sku}
                    </span>
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{item.quantity}</td>
                  <td className="py-1 pr-3 text-right">
                    <MoneyText amount={item.list_price} />
                  </td>
                  <td className="py-1 text-right">
                    <MoneyText amount={item.gross_line_amount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-sm">
          <dt>Giá niêm yết</dt>
          <dd className="text-right">
            <MoneyText amount={data.gross_amount} />
          </dd>
          <dt>Giảm giá</dt>
          <dd className="text-right">
            <MoneyText amount={data.discount_amount} />
          </dd>
          <dt className="font-semibold">Khách phải trả</dt>
          <dd className="text-right font-semibold">
            <MoneyText amount={data.net_amount} />
          </dd>
          <dt>Đã thanh toán</dt>
          <dd className="text-right">
            <MoneyText amount={data.paid_amount} />
          </dd>
          <dt>Còn lại</dt>
          <dd className="text-right">
            <MoneyText amount={data.remaining_amount ?? 0} />
          </dd>
        </dl>
      </section>

      <OrderPaymentPanel
        orderId={data.id}
        status={data.status}
        isAdmin={isAdmin}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ['order', orderId] })
          void queryClient.invalidateQueries({ queryKey: ['order-history', orderId] })
          void queryClient.invalidateQueries({ queryKey: ['order-stock', orderId] })
          void queryClient.invalidateQueries({ queryKey: ['orders'] })
        }}
      />

      <OrderStockPanel
        orderId={data.id}
        orderCode={data.order_code}
        status={data.status}
        canAllocate={isAdmin}
        onAllocated={() => {
          void queryClient.invalidateQueries({ queryKey: ['order', orderId] })
          void queryClient.invalidateQueries({ queryKey: ['order-history', orderId] })
          void queryClient.invalidateQueries({ queryKey: ['orders'] })
        }}
      />

      <section className="rounded-lg border border-slate-200 bg-white p-4 print:hidden">
        <h2 className="mb-3 font-semibold text-slate-900">Lịch sử đơn hàng</h2>
        {history.isPending ? <LoadingState /> : null}
        {history.isError ? <p className="text-sm text-red-700">Không tải được lịch sử.</p> : null}
        {history.data ? <OrderTimeline entries={history.data} /> : null}
      </section>

      <OrderActionDialog
        action={action}
        orderCode={data.order_code}
        onClose={() => setAction(null)}
        run={(a, reason) => service.transition(data.id, a, reason)}
        onDone={() => {
          if (action) setNotice(`Đã thực hiện: ${ACTION_COPY[action].button}.`)
          setAction(null)
          void queryClient.invalidateQueries({ queryKey: ['order', orderId] })
          void queryClient.invalidateQueries({ queryKey: ['order-history', orderId] })
          void queryClient.invalidateQueries({ queryKey: ['orders'] })
          void queryClient.invalidateQueries({ queryKey: ['order-stock', orderId] })
        }}
      />
    </article>
  )
}
