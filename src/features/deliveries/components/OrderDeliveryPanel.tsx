import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { ROUTES } from '@/app/routes'
import { MoneyText } from '@/components/shared/MoneyText'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/Button'
import {
  DELIVERY_ACTION_LABELS,
  DELIVERY_METHOD_LABELS,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONES,
  availableDeliveryActions,
  canPlanDelivery,
  canReschedule,
  isDeliveryEditable,
  unassignedQuantity,
  type DeliveryAction,
} from '@/domain/deliveries/deliveries'
import { formatDate } from '@/lib/date'
import type { OrderDelivery } from '@/services/deliveries.service'
import { useDeliveryService } from '../hooks/useDeliveryService'
import { DeliveryActionDialog, RescheduleDialog } from './DeliveryDialogs'
import { DeliveryFormDialog, type PlanOrder } from './DeliveryFormDialog'

interface Props {
  orderId: string
  orderStatus: string
  creationLocationId: string
  items: { id: string; name: string; sku: string; quantity: number }[]
  /** Admin, or the salesperson who owns the order. */
  isPlanner: boolean
  /** Admin or Warehouse. */
  isWarehouseStaff: boolean
  /** Called after any change so the order, its history and its stock can refresh. */
  onChanged: () => void
}

/** DEL-002/004/005: the delivery plan of an order: batches, what is still unassigned, and the steps. */
export function OrderDeliveryPanel({
  orderId,
  orderStatus,
  creationLocationId,
  items,
  isPlanner,
  isWarehouseStaff,
  onChanged,
}: Props) {
  const service = useDeliveryService()
  const deliveries = useQuery({
    queryKey: ['order-deliveries', orderId],
    queryFn: () => service.listForOrder(orderId),
  })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<OrderDelivery | null>(null)
  const [acting, setActing] = useState<{ delivery: OrderDelivery; action: DeliveryAction } | null>(
    null,
  )
  const [rescheduling, setRescheduling] = useState<OrderDelivery | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = () => {
    void deliveries.refetch()
    onChanged()
  }

  const active = (deliveries.data ?? []).filter((d) => d.status !== 'CANCELLED')
  const assigned: Record<string, number> = {}
  for (const d of active) {
    for (const item of d.delivery_items) {
      assigned[item.order_item_id] = (assigned[item.order_item_id] ?? 0) + item.quantity
    }
  }
  const unassigned = items
    .map((i) => ({ ...i, left: unassignedQuantity(i.quantity, assigned[i.id] ?? 0) }))
    .filter((i) => i.left > 0)

  /** For the form: exclude the delivery being edited from "already assigned". */
  const planOrder: PlanOrder = {
    id: orderId,
    creationLocationId,
    items,
    assigned: (() => {
      if (!editing) return assigned
      const copy = { ...assigned }
      for (const item of editing.delivery_items) {
        copy[item.order_item_id] = (copy[item.order_item_id] ?? 0) - item.quantity
      }
      return copy
    })(),
  }

  const canPlan = isPlanner && canPlanDelivery(orderStatus) && unassigned.length > 0

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 print:hidden">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Giao hàng</h2>
        {canPlan ? (
          <Button
            variant="secondary"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            Lập đợt giao
          </Button>
        ) : null}
      </div>

      {notice ? (
        <p role="status" className="mb-3 rounded-md bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      ) : null}

      {deliveries.isPending ? <LoadingState /> : null}
      {deliveries.isError ? (
        <ErrorState
          title="Không tải được lịch giao hàng"
          action={{ label: 'Thử lại', onClick: () => void deliveries.refetch() }}
        >
          Vui lòng kiểm tra kết nối mạng rồi thử lại.
        </ErrorState>
      ) : null}
      {deliveries.isSuccess && deliveries.data.length === 0 ? (
        <EmptyState title="Chưa có đợt giao nào">
          {canPlan
            ? 'Bấm "Lập đợt giao" để chọn ngày, địa chỉ và số lượng giao. Một đơn có thể giao nhiều đợt.'
            : 'Đơn này chưa có đợt giao.'}
        </EmptyState>
      ) : null}

      {deliveries.isSuccess && deliveries.data.length > 0 && unassigned.length > 0 ? (
        <p className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Chưa xếp lịch giao: {unassigned.map((i) => `${i.name} × ${i.left}`).join(', ')}.
        </p>
      ) : null}
      {deliveries.isSuccess && deliveries.data.length > 0 && unassigned.length === 0 ? (
        <p className="mb-3 text-sm text-green-800">Toàn bộ số lượng đặt đã được xếp lịch giao.</p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {deliveries.data?.map((d) => {
          const actions = availableDeliveryActions(d.status, { isWarehouseStaff, isPlanner })
          return (
            <li key={d.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">
                  <span className="font-mono">{d.delivery_code}</span> ·{' '}
                  {formatDate(d.scheduled_date)}
                  {d.scheduled_time ? ` ${d.scheduled_time.slice(0, 5)}` : ''}
                </p>
                <StatusBadge
                  label={DELIVERY_STATUS_LABELS[d.status]}
                  tone={DELIVERY_STATUS_TONES[d.status]}
                />
              </div>
              <p className="text-slate-700">
                {d.delivery_items
                  .map((i) => `${i.products?.name ?? '—'} × ${i.quantity}`)
                  .join(', ')}
              </p>
              <p className="text-slate-600">
                {DELIVERY_METHOD_LABELS[d.delivery_method]} · {d.recipient_name} ·{' '}
                {d.recipient_phone}
                {d.delivery_address ? ` · ${d.delivery_address}` : ''}
              </p>
              <p className="text-slate-600">
                Kho xuất: {d.locations?.code ?? '—'}
                {d.shipping_fee > 0 ? (
                  <>
                    {' '}
                    · Phí giao <MoneyText amount={d.shipping_fee} />
                  </>
                ) : null}
              </p>
              {d.failed_reason && d.status === 'FAILED' ? (
                <p className="text-red-800">Lý do thất bại: {d.failed_reason}</p>
              ) : null}
              {d.cancelled_reason ? (
                <p className="text-slate-600">Lý do hủy: {d.cancelled_reason}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {isPlanner && isDeliveryEditable(d.status) ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditing(d)
                      setFormOpen(true)
                    }}
                  >
                    Sửa
                  </Button>
                ) : null}
                {actions.map((a) => (
                  <Button
                    key={a}
                    variant={a === 'cancel' || a === 'fail' ? 'secondary' : 'primary'}
                    onClick={() => setActing({ delivery: d, action: a })}
                  >
                    {DELIVERY_ACTION_LABELS[a]}
                  </Button>
                ))}
                {canReschedule(d.status, isWarehouseStaff) ? (
                  <Button variant="secondary" onClick={() => setRescheduling(d)}>
                    Đổi lịch
                  </Button>
                ) : null}
                {d.status !== 'CANCELLED' ? (
                  <>
                    <Link
                      className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 hover:bg-slate-50"
                      to={ROUTES.deliveryPrint(d.id)}
                    >
                      Phiếu giao hàng
                    </Link>
                    {isWarehouseStaff ? (
                      <Link
                        className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 hover:bg-slate-50"
                        to={ROUTES.deliveryIssue(d.id)}
                      >
                        Phiếu xuất kho
                      </Link>
                    ) : null}
                  </>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      <DeliveryFormDialog
        open={formOpen}
        order={planOrder}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false)
          setNotice(editing ? 'Đã lưu đợt giao.' : 'Đã lập đợt giao.')
          refresh()
        }}
      />
      <DeliveryActionDialog
        deliveryId={acting?.delivery.id ?? null}
        deliveryCode={acting?.delivery.delivery_code ?? ''}
        action={acting?.action ?? null}
        onClose={() => setActing(null)}
        onDone={(a) => {
          setActing(null)
          setNotice(`Đã thực hiện: ${DELIVERY_ACTION_LABELS[a]}.`)
          refresh()
        }}
      />
      <RescheduleDialog
        deliveryId={rescheduling?.id ?? null}
        deliveryCode={rescheduling?.delivery_code ?? ''}
        failed={rescheduling?.status === 'FAILED'}
        currentDate={rescheduling?.scheduled_date ?? ''}
        onClose={() => setRescheduling(null)}
        onDone={() => {
          setRescheduling(null)
          setNotice('Đã đổi lịch giao.')
          refresh()
        }}
      />
    </section>
  )
}
