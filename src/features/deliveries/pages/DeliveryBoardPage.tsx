import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { ROUTES } from '@/app/routes'
import { MoneyText } from '@/components/shared/MoneyText'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/Button'
import {
  BOARD_RANGES,
  BOARD_RANGE_LABELS,
  DELIVERY_ACTION_LABELS,
  DELIVERY_METHOD_LABELS,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONES,
  availableDeliveryActions,
  boardRange,
  canReschedule,
  groupByDate,
  vietnamToday,
  type BoardRange,
  type DeliveryAction,
} from '@/domain/deliveries/deliveries'
import { useAuth } from '@/features/auth/auth-context'
import { describeDbError } from '@/lib/db-errors'
import { formatDate } from '@/lib/date'
import type { ScheduleRow } from '@/services/deliveries.service'
import { DeliveryActionDialog, RescheduleDialog } from '../components/DeliveryDialogs'
import { useDeliveryService } from '../hooks/useDeliveryService'

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy']

function dayHeading(isoDate: string, today: string): string {
  const weekday = WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()]
  const tag = isoDate === today ? ' · Hôm nay' : ''
  return `${weekday}, ${formatDate(isoDate)}${tag}`
}

/** DEL-007..010: what must be delivered today / tomorrow / the next 7 days / this month. */
export function DeliveryBoardPage() {
  const service = useDeliveryService()
  const queryClient = useQueryClient()
  const { access } = useAuth()
  const role = access.status === 'active' ? access.user.roleCode : null
  const isWarehouseStaff = role === 'ADMIN' || role === 'WAREHOUSE'
  const today = vietnamToday()
  const [range, setRange] = useState<BoardRange>('today')
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [acting, setActing] = useState<{ row: ScheduleRow; action: DeliveryAction } | null>(null)
  const [rescheduling, setRescheduling] = useState<ScheduleRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { from, to } = boardRange(range, today)
  const schedule = useQuery({
    queryKey: ['delivery-schedule', from, to],
    queryFn: () => service.schedule(from, to),
  })

  const rows = (schedule.data ?? []).filter(
    (r) => !onlyOpen || !['DELIVERED', 'CANCELLED'].includes(r.status),
  )
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['delivery-schedule'] })
    void queryClient.invalidateQueries({ queryKey: ['order-deliveries'] })
  }
  const totalQty = rows.reduce((sum, r) => sum + Number(r.total_quantity), 0)

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-slate-900">Lịch giao hàng</h1>
        <p className="text-sm text-slate-600">
          {isWarehouseStaff
            ? 'Tất cả đợt giao đã lên lịch. Kho chuẩn bị, xuất kho và xác nhận giao tại đây.'
            : 'Các đợt giao của đơn do bạn phụ trách.'}
        </p>
      </header>

      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label="Khoảng thời gian"
      >
        {BOARD_RANGES.map((r) => (
          <button
            key={r}
            role="tab"
            aria-selected={range === r}
            onClick={() => setRange(r)}
            className={`min-h-11 rounded-md px-4 text-sm ${
              range === r
                ? 'bg-green-700 font-medium text-white'
                : 'border border-slate-300 bg-white'
            }`}
          >
            {BOARD_RANGE_LABELS[r]}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
          />
          Ẩn đợt đã giao / đã hủy
        </label>
      </div>

      {notice ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      ) : null}

      {schedule.isPending ? <LoadingState /> : null}
      {schedule.isError ? (
        <ErrorState
          title="Không tải được lịch giao hàng"
          action={{ label: 'Thử lại', onClick: () => void schedule.refetch() }}
        >
          {describeDbError(schedule.error as { code?: string; message?: string })}
        </ErrorState>
      ) : null}
      {schedule.isSuccess && rows.length === 0 ? (
        <EmptyState title="Không có đợt giao nào trong khoảng này">
          Chọn khoảng thời gian khác hoặc bỏ lọc "Ẩn đợt đã giao / đã hủy".
        </EmptyState>
      ) : null}
      {schedule.isSuccess && rows.length > 0 ? (
        <p className="text-sm text-slate-600">
          {rows.length} đợt giao · tổng {totalQty} sản phẩm
        </p>
      ) : null}

      {groupByDate(rows).map(([day, list]) => (
        <div key={day} className="flex flex-col gap-2">
          <h2 className="font-semibold text-slate-900">{dayHeading(day, today)}</h2>
          {list.map((row) => {
            const actions = availableDeliveryActions(row.status, {
              isWarehouseStaff,
              isPlanner: false,
            })
            return (
              <article
                key={row.delivery_id}
                className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">
                    <span className="font-mono">{row.delivery_code}</span>
                    {row.scheduled_time ? ` · ${row.scheduled_time.slice(0, 5)}` : ''} ·{' '}
                    {row.customer_name}
                  </p>
                  <div className="flex gap-1">
                    {row.stock_risk ? (
                      <StatusBadge label="Chưa đủ hàng phân bổ" tone="danger" />
                    ) : null}
                    <StatusBadge
                      label={DELIVERY_STATUS_LABELS[row.status]}
                      tone={DELIVERY_STATUS_TONES[row.status]}
                    />
                  </div>
                </div>
                <p className="text-slate-700">
                  {(row.lines ?? []).map((l) => `${l.name} × ${l.quantity}`).join(', ')}
                </p>
                <p className="text-slate-600">
                  {DELIVERY_METHOD_LABELS[row.delivery_method]} · {row.recipient_name} ·{' '}
                  {row.recipient_phone}
                  {row.delivery_address ? ` · ${row.delivery_address}` : ''}
                </p>
                <p className="text-slate-600">
                  Kho xuất {row.source_location_code} · Phụ trách {row.owner_name} · Còn phải thu{' '}
                  <MoneyText amount={row.remaining_amount} />
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {actions.map((a) => (
                    <Button
                      key={a}
                      variant={a === 'fail' ? 'secondary' : 'primary'}
                      onClick={() => setActing({ row, action: a })}
                    >
                      {DELIVERY_ACTION_LABELS[a]}
                    </Button>
                  ))}
                  {canReschedule(row.status, isWarehouseStaff) ? (
                    <Button variant="secondary" onClick={() => setRescheduling(row)}>
                      Đổi lịch
                    </Button>
                  ) : null}
                  <Link
                    className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 hover:bg-slate-50"
                    to={ROUTES.orderDetail(row.order_id)}
                  >
                    Mở đơn {row.order_code}
                  </Link>
                  <Link
                    className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 hover:bg-slate-50"
                    to={ROUTES.deliveryPrint(row.delivery_id)}
                  >
                    Phiếu giao
                  </Link>
                  {isWarehouseStaff ? (
                    <Link
                      className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 hover:bg-slate-50"
                      to={ROUTES.deliveryIssue(row.delivery_id)}
                    >
                      Phiếu xuất kho
                    </Link>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      ))}

      <DeliveryActionDialog
        deliveryId={acting?.row.delivery_id ?? null}
        deliveryCode={acting?.row.delivery_code ?? ''}
        action={acting?.action ?? null}
        onClose={() => setActing(null)}
        onDone={(a) => {
          setActing(null)
          setNotice(`Đã thực hiện: ${DELIVERY_ACTION_LABELS[a]}.`)
          refresh()
        }}
      />
      <RescheduleDialog
        deliveryId={rescheduling?.delivery_id ?? null}
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
