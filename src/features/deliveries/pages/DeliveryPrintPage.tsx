import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { ROUTES } from '@/app/routes'
import { MoneyText } from '@/components/shared/MoneyText'
import { ErrorState, LoadingState } from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import {
  DELIVERY_METHOD_LABELS,
  DELIVERY_STATUS_LABELS,
  SHIPPING_PAYER_LABELS,
} from '@/domain/deliveries/deliveries'
import { formatDate } from '@/lib/date'
import { useDeliveryService } from '../hooks/useDeliveryService'

/**
 * DEL-014: delivery note (what the customer receives) and DEL-015: warehouse issue note
 * (what the warehouse must pick, batch by batch, earliest expiry first).
 */
export function DeliveryPrintPage({ mode }: { mode: 'note' | 'issue' }) {
  const { deliveryId = '' } = useParams()
  const service = useDeliveryService()
  const detail = useQuery({
    queryKey: ['delivery-detail', deliveryId],
    queryFn: () => service.detail(deliveryId),
  })

  if (detail.isPending) return <LoadingState />
  if (detail.isError || !detail.data) {
    return (
      <ErrorState title="Không tải được đợt giao">
        Đợt giao không tồn tại hoặc bạn không có quyền xem.
      </ErrorState>
    )
  }
  const { delivery, order, source_location: source, items } = detail.data
  const isIssue = mode === 'issue'

  return (
    <article className="mx-auto max-w-3xl bg-white p-6 text-slate-900 print:p-0">
      <div className="mb-4 flex justify-between gap-2 print:hidden">
        <Link className="underline" to={ROUTES.orderDetail(order.id)}>
          ← Quay lại đơn hàng
        </Link>
        <Button onClick={() => window.print()}>In</Button>
      </div>

      <header className="mb-4 border-b border-slate-300 pb-3 text-center">
        <p className="text-sm font-semibold tracking-wide">CHB FOOD</p>
        <h1 className="text-xl font-bold">
          {isIssue ? 'PHIẾU XUẤT KHO' : 'PHIẾU GIAO HÀNG'} — BÁNH CHƯNG TẾT 2027
        </h1>
        <p className="mt-1 font-mono text-lg">{delivery.delivery_code}</p>
        <p className="text-sm">
          Đơn {order.order_code} · Trạng thái: {DELIVERY_STATUS_LABELS[delivery.status]}
        </p>
      </header>

      <dl className="mb-4 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="font-medium">Ngày giao</dt>
        <dd>
          {formatDate(delivery.scheduled_date)}
          {delivery.scheduled_time ? ` · ${delivery.scheduled_time.slice(0, 5)}` : ''}
        </dd>
        <dt className="font-medium">Hình thức</dt>
        <dd>{DELIVERY_METHOD_LABELS[delivery.delivery_method]}</dd>
        <dt className="font-medium">Người nhận</dt>
        <dd>
          {delivery.recipient_name} · {delivery.recipient_phone}
        </dd>
        <dt className="font-medium">Địa chỉ</dt>
        <dd>{delivery.delivery_address ?? '—'}</dd>
        <dt className="font-medium">Kho xuất</dt>
        <dd>{source ? `${source.code} · ${source.name}` : '—'}</dd>
        {delivery.notes ? (
          <>
            <dt className="font-medium">Ghi chú</dt>
            <dd className="whitespace-pre-line">{delivery.notes}</dd>
          </>
        ) : null}
      </dl>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-400 text-left">
            <th className="py-1">Mã</th>
            <th className="py-1">Sản phẩm</th>
            <th className="py-1 text-right">Số lượng</th>
            {isIssue ? <th className="py-1">Lô lấy hàng (hết hạn sớm trước)</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.order_item_id} className="border-b border-slate-200 align-top">
              <td className="py-1 font-mono">{item.sku}</td>
              <td className="py-1">{item.name}</td>
              <td className="py-1 text-right">{item.quantity}</td>
              {isIssue ? (
                <td className="py-1">
                  {item.pick.length === 0 ? (
                    <span className="text-red-700">Chưa phân bổ hàng cho đơn</span>
                  ) : (
                    item.pick.map((p) => (
                      <div key={`${p.batch_code}-${p.expiry_date}`}>
                        {p.batch_code} · HSD {formatDate(p.expiry_date)} · {p.quantity}
                      </div>
                    ))
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {isIssue ? (
        <div className="mt-8 grid grid-cols-2 gap-8 text-center text-sm">
          <p>
            Thủ kho
            <br />
            <span className="text-xs text-slate-500">(ký, ghi rõ họ tên)</span>
          </p>
          <p>
            Người nhận hàng
            <br />
            <span className="text-xs text-slate-500">(ký, ghi rõ họ tên)</span>
          </p>
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-slate-300 pt-3 text-sm">
            <dt>Giá trị đơn hàng</dt>
            <dd className="text-right">
              <MoneyText amount={order.net_amount} />
            </dd>
            <dt>Đã thanh toán</dt>
            <dd className="text-right">
              <MoneyText amount={order.paid_amount} />
            </dd>
            <dt className="font-semibold">Còn phải thu khi giao</dt>
            <dd className="text-right font-semibold">
              <MoneyText amount={order.remaining_amount} />
            </dd>
            {delivery.shipping_fee > 0 ? (
              <>
                <dt>Phí giao hàng ({SHIPPING_PAYER_LABELS[delivery.shipping_fee_payer]})</dt>
                <dd className="text-right">
                  <MoneyText amount={delivery.shipping_fee} />
                </dd>
              </>
            ) : null}
          </dl>
          <div className="mt-8 grid grid-cols-2 gap-8 text-center text-sm">
            <p>
              Người giao
              <br />
              <span className="text-xs text-slate-500">(ký, ghi rõ họ tên)</span>
            </p>
            <p>
              Khách hàng nhận hàng
              <br />
              <span className="text-xs text-slate-500">(ký, ghi rõ họ tên)</span>
            </p>
          </div>
        </>
      )}
    </article>
  )
}
