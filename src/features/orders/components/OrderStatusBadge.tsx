import { StatusBadge, type BadgeTone } from '@/components/shared/StatusBadge'
import { ORDER_STATUS_LABELS, isOrderStatus, type OrderStatus } from '@/domain/orders/state-machine'

const TONES: Record<OrderStatus, BadgeTone> = {
  DRAFT: 'neutral',
  WAITING_CONFIRMATION: 'warning',
  WAITING_DEPOSIT: 'warning',
  CONFIRMED: 'info',
  RESERVED: 'info',
  PREPARING: 'info',
  WAITING_DELIVERY: 'info',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  VOIDED: 'muted',
  RETURNED: 'warning',
  EXCHANGED: 'warning',
}

export function OrderStatusBadge({ status }: { status: string }) {
  if (!isOrderStatus(status)) return <StatusBadge label={status} />
  return <StatusBadge label={ORDER_STATUS_LABELS[status]} tone={TONES[status]} />
}
