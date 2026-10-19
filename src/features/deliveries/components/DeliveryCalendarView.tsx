import { monthGrid, monthLabel } from '@/domain/deliveries/calendar'
import type { ScheduleRow } from '@/services/deliveries.service'

const WEEKDAYS = ['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật']

interface Props {
  month: string
  selectedDate: string
  today: string
  rows: ScheduleRow[]
  onSelectDate: (date: string) => void
  onPreviousMonth: () => void
  onNextMonth: () => void
  onToday: () => void
}

export function DeliveryCalendarView({
  month,
  selectedDate,
  today,
  rows,
  onSelectDate,
  onPreviousMonth,
  onNextMonth,
  onToday,
}: Props) {
  const counts = new Map<string, { count: number; stockRisk: boolean }>()
  for (const row of rows) {
    const current = counts.get(row.scheduled_date) ?? { count: 0, stockRisk: false }
    current.count += 1
    current.stockRisk ||= row.stock_risk
    counts.set(row.scheduled_date, current)
  }

  return (
    <section
      aria-label={`Lịch giao hàng ${monthLabel(month)}`}
      className="rounded-lg border border-slate-200 bg-white p-3"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold text-slate-900">{monthLabel(month)}</h2>
        <button
          type="button"
          onClick={onPreviousMonth}
          className="min-h-11 rounded-md border border-slate-300 px-3 text-sm"
          aria-label="Tháng trước"
        >
          Tháng trước
        </button>
        <button
          type="button"
          onClick={onToday}
          className="min-h-11 rounded-md border border-slate-300 px-3 text-sm"
        >
          Hôm nay
        </button>
        <button
          type="button"
          onClick={onNextMonth}
          className="min-h-11 rounded-md border border-slate-300 px-3 text-sm"
          aria-label="Tháng sau"
        >
          Tháng sau
        </button>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] grid-cols-7 gap-1">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="py-1 text-center text-xs font-medium text-slate-600">
              {weekday}
            </div>
          ))}
          {monthGrid(month).map((date, index) => {
            if (!date)
              return (
                <div key={`blank-${index}`} aria-hidden="true" className="min-h-16 bg-slate-50" />
              )
            const summary = counts.get(date)
            const selected = date === selectedDate
            return (
              <button
                key={date}
                type="button"
                onClick={() => onSelectDate(date)}
                aria-pressed={selected}
                aria-label={`${date === today ? 'Hôm nay, ' : ''}${date}, ${summary?.count ?? 0} đợt giao${summary?.stockRisk ? ', có đợt chưa đủ hàng phân bổ' : ''}`}
                className={`min-h-16 rounded-md border p-1 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-700 ${selected ? 'border-green-700 bg-green-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
              >
                <span
                  className={
                    date === today ? 'font-bold text-green-800' : 'font-medium text-slate-900'
                  }
                >
                  {Number(date.slice(-2))}
                </span>
                {summary ? (
                  <span className="block text-xs text-slate-700">{summary.count} đợt</span>
                ) : null}
                {summary?.stockRisk ? (
                  <span className="block text-xs font-medium text-red-700">Thiếu hàng</span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
