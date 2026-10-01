import { formatDate } from '@/lib/date'
import { formatVnd } from '@/lib/money'

export interface HistorySummary {
  orderCount: number
  totalGross: number
  lastOrderAt: string | null
}

/** "3 đơn · 4.800.000 ₫" or "Chưa có đơn" (customers without orders are absent from the summary). */
export function describeHistory(history: HistorySummary | undefined): string {
  if (!history || history.orderCount === 0) return 'Chưa có đơn'
  return `${history.orderCount} đơn · ${formatVnd(history.totalGross)}`
}

/** Date of the latest order in Vietnam time, or '' when there is none. */
export function lastOrderDate(history: HistorySummary | undefined): string {
  if (!history?.lastOrderAt) return ''
  const vietnam = new Date(new Date(history.lastOrderAt).getTime() + 7 * 60 * 60 * 1000)
  return formatDate(vietnam.toISOString().slice(0, 10))
}
