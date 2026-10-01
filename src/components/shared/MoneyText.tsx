import { formatDateTime } from '@/lib/date'
import { formatVnd } from '@/lib/money'

/** Integer VND, formatted in one place for the whole app. */
export function MoneyText({ amount, className = '' }: { amount: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatVnd(amount)}</span>
}

/** Database timestamp shown in Vietnam time. */
export function DateTimeText({ value }: { value: string }) {
  return <time dateTime={value}>{formatDateTime(value)}</time>
}
