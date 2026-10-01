import { DateTimeText } from '@/components/shared/MoneyText'
import { ORDER_STATUS_LABELS, isOrderStatus } from '@/domain/orders/state-machine'
import type { StatusHistoryEntry } from '@/services/orders.service'

const label = (status: string | null) =>
  status && isOrderStatus(status) ? ORDER_STATUS_LABELS[status] : (status ?? '')

/** ORD-013: who moved the order to which status, when and why (oldest first). */
export function OrderTimeline({ entries }: { entries: StatusHistoryEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-slate-600">Chưa có lịch sử.</p>
  return (
    <ol className="flex flex-col gap-3 border-l-2 border-slate-200 pl-4">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span
            className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-green-700"
            aria-hidden
          />
          <p className="font-medium text-slate-900">
            {entry.from_status === null
              ? `Tạo đơn (${label(entry.to_status)})`
              : `${label(entry.from_status)} → ${label(entry.to_status)}`}
          </p>
          <p className="text-sm text-slate-600">
            <DateTimeText value={entry.created_at} />
            {entry.actor?.full_name ? ` · ${entry.actor.full_name}` : ''}
          </p>
          {entry.reason ? <p className="text-sm text-slate-800">Lý do: {entry.reason}</p> : null}
        </li>
      ))}
    </ol>
  )
}
