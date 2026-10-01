import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextAreaField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import {
  DELIVERY_ACTION_CONSEQUENCES,
  DELIVERY_ACTION_LABELS,
  DELIVERY_ACTION_NEEDS_REASON,
  vietnamToday,
  type DeliveryAction,
} from '@/domain/deliveries/deliveries'
import { describeDbError } from '@/lib/db-errors'
import { useDeliveryService } from '../hooks/useDeliveryService'

type DbErr = { code?: string; message?: string }

interface ActionProps {
  deliveryId: string | null
  deliveryCode: string
  action: DeliveryAction | null
  onClose: () => void
  onDone: (action: DeliveryAction) => void
}

/** Confirms a delivery step, states its consequence and asks for a reason where one is required. */
export function DeliveryActionDialog({ action, ...rest }: ActionProps) {
  return (
    <Dialog
      open={action !== null && rest.deliveryId !== null}
      title={action ? `${DELIVERY_ACTION_LABELS[action]} · ${rest.deliveryCode}` : ''}
      onClose={rest.onClose}
    >
      {action && rest.deliveryId ? (
        <ActionBody key={`${rest.deliveryId}-${action}`} action={action} {...rest} />
      ) : null}
    </Dialog>
  )
}

function ActionBody({
  deliveryId,
  action,
  onClose,
  onDone,
}: ActionProps & { action: DeliveryAction }) {
  const service = useDeliveryService()
  const needsReason = DELIVERY_ACTION_NEEDS_REASON[action]
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => service.transition(deliveryId as string, action, reason.trim() || undefined),
    onSuccess: () => onDone(action),
  })

  return (
    <div className="flex flex-col gap-4">
      <p className="text-slate-800">{DELIVERY_ACTION_CONSEQUENCES[action]}</p>
      {needsReason ? (
        <TextAreaField
          label={action === 'fail' ? 'Lý do giao thất bại' : 'Lý do hủy đợt giao'}
          rows={3}
          value={reason}
          error={reasonError ?? undefined}
          onChange={(e) => setReason(e.target.value)}
        />
      ) : null}
      {mutation.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(mutation.error as DbErr)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Quay lại
        </Button>
        <Button
          loading={mutation.isPending}
          onClick={() => {
            if (needsReason && reason.trim() === '') {
              setReasonError('Vui lòng nhập lý do.')
              return
            }
            setReasonError(null)
            mutation.mutate()
          }}
        >
          {DELIVERY_ACTION_LABELS[action]}
        </Button>
      </div>
    </div>
  )
}

interface RescheduleProps {
  deliveryId: string | null
  deliveryCode: string
  failed: boolean
  currentDate: string
  onClose: () => void
  onDone: () => void
}

/** DEL-013: choose another day (and optionally a time) for a failed or not yet dispatched delivery. */
export function RescheduleDialog(props: RescheduleProps) {
  return (
    <Dialog
      open={props.deliveryId !== null}
      title={`Đổi lịch giao · ${props.deliveryCode}`}
      onClose={props.onClose}
    >
      {props.deliveryId ? <RescheduleBody key={props.deliveryId} {...props} /> : null}
    </Dialog>
  )
}

function RescheduleBody({ deliveryId, failed, currentDate, onClose, onDone }: RescheduleProps) {
  const service = useDeliveryService()
  const today = vietnamToday()
  const [date, setDate] = useState(currentDate < today ? today : currentDate)
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => service.reschedule(deliveryId as string, date, time || null, reason.trim()),
    onSuccess: onDone,
  })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-slate-800">
        {failed
          ? 'Đợt giao thất bại sẽ quay lại "Sẵn sàng giao" vào ngày mới. Hàng vẫn được giữ cho đơn.'
          : 'Đợt giao được chuyển sang ngày mới, trạng thái giữ nguyên.'}
      </p>
      <TextField
        label="Ngày giao mới"
        type="date"
        min={today}
        value={date}
        error={error ?? undefined}
        onChange={(e) => setDate(e.target.value)}
      />
      <TextField
        label="Giờ giao (không bắt buộc)"
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
      />
      <TextAreaField
        label="Ghi chú đổi lịch (không bắt buộc)"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {mutation.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(mutation.error as DbErr)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Quay lại
        </Button>
        <Button
          loading={mutation.isPending}
          onClick={() => {
            if (date < today) {
              setError('Ngày giao mới phải từ hôm nay trở đi.')
              return
            }
            setError(null)
            mutation.mutate()
          }}
        >
          Đổi lịch
        </Button>
      </div>
    </div>
  )
}
