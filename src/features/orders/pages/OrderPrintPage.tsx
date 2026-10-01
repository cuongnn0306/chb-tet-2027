import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { ROUTES } from '@/app/routes'
import { MoneyText } from '@/components/shared/MoneyText'
import { ErrorState, LoadingState } from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import { customerDisplayName } from '@/domain/customers/validation'
import { ORDER_STATUS_LABELS, isOrderStatus } from '@/domain/orders/state-machine'
import { formatDateTime } from '@/lib/date'
import { useOrderService } from '../hooks/useOrderService'

/** ORD-014: print-friendly order sheet. The app header and buttons are hidden when printing. */
export function OrderPrintPage() {
  const { orderId = '' } = useParams()
  const service = useOrderService()
  const order = useQuery({ queryKey: ['order', orderId], queryFn: () => service.get(orderId) })

  if (order.isPending) return <LoadingState />
  if (order.isError || !order.data) {
    return (
      <ErrorState title="Không tải được đơn hàng">
        Đơn không tồn tại hoặc bạn không có quyền xem đơn này.
      </ErrorState>
    )
  }
  const data = order.data
  const customer = data.customers
  const items = [...data.order_items].sort((a, b) =>
    (a.products?.sku ?? '').localeCompare(b.products?.sku ?? ''),
  )

  return (
    <article className="mx-auto max-w-3xl bg-white p-6 text-slate-900 print:p-0">
      <div className="mb-4 flex justify-between gap-2 print:hidden">
        <Link className="underline" to={ROUTES.orderDetail(data.id)}>
          ← Quay lại đơn hàng
        </Link>
        <Button onClick={() => window.print()}>In</Button>
      </div>

      <header className="mb-4 border-b border-slate-300 pb-3 text-center">
        <p className="text-sm font-semibold tracking-wide">CHB FOOD</p>
        <h1 className="text-xl font-bold">PHIẾU ĐƠN HÀNG — BÁNH CHƯNG TẾT 2027</h1>
        <p className="mt-1 font-mono text-lg">{data.order_code}</p>
        <p className="text-sm">
          Ngày tạo: {formatDateTime(data.created_at)} · Trạng thái:{' '}
          {isOrderStatus(data.status) ? ORDER_STATUS_LABELS[data.status] : data.status}
        </p>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <h2 className="font-semibold">Khách hàng</h2>
          {customer ? (
            <>
              <p>{customerDisplayName(customer)}</p>
              {customer.phone ? <p>SĐT: {customer.phone}</p> : null}
              {customer.customer_type === 'COMPANY' ? (
                <>
                  {customer.tax_code ? <p>MST: {customer.tax_code}</p> : null}
                  {customer.contact_name ? <p>Liên hệ: {customer.contact_name}</p> : null}
                  {customer.company_address ? <p>{customer.company_address}</p> : null}
                </>
              ) : customer.address ? (
                <p>{customer.address}</p>
              ) : null}
            </>
          ) : null}
        </div>
        <div>
          <h2 className="font-semibold">Thông tin đơn</h2>
          <p>Người phụ trách: {data.owner?.full_name ?? '—'}</p>
          <p>Điểm tạo đơn: {data.locations?.name ?? '—'}</p>
          <p>Kênh bán: {data.sales_channels?.name ?? '—'}</p>
          {data.requires_invoice ? <p>Khách cần xuất hóa đơn</p> : null}
        </div>
      </section>

      <table className="mb-4 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-y border-slate-400">
            <th className="py-1 pr-2">Sản phẩm</th>
            <th className="py-1 pr-2 text-right">SL</th>
            <th className="py-1 pr-2 text-right">Giá niêm yết</th>
            <th className="py-1 text-right">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-slate-200">
              <td className="py-1 pr-2">
                {item.products?.name}{' '}
                <span className="text-xs text-slate-500">({item.products?.sku})</span>
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">{item.quantity}</td>
              <td className="py-1 pr-2 text-right">
                <MoneyText amount={item.list_price} />
              </td>
              <td className="py-1 text-right">
                <MoneyText amount={item.gross_line_amount} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt>Giá niêm yết</dt>
        <dd className="text-right">
          <MoneyText amount={data.gross_amount} />
        </dd>
        <dt>Giảm giá</dt>
        <dd className="text-right">
          <MoneyText amount={data.discount_amount} />
        </dd>
        <dt className="font-bold">Khách phải trả</dt>
        <dd className="text-right font-bold">
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

      {data.notes ? <p className="mt-4 text-sm">Ghi chú: {data.notes}</p> : null}
    </article>
  )
}
