import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  TRANSFER_STATUS_LABELS,
  TRANSFER_STATUS_TONES,
  type TransferStatus,
} from '@/domain/transfers/transfers'

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  return <StatusBadge label={TRANSFER_STATUS_LABELS[status]} tone={TRANSFER_STATUS_TONES[status]} />
}
