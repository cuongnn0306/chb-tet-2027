import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextAreaField } from '@/components/ui/fields'
import { ORDER_ACTION_RULES, type OrderAction } from '@/domain/orders/state-machine'
import { ACTION_COPY } from '../action-copy'
import { describeDbError } from '@/lib/db-errors'

interface Props {
  action: OrderAction | null
  orderCode: string
  onClose: () => void
  /** Performs the transition; throw to show an error. */
  run: (action: OrderAction, reason?: string) => Promise<unknown>
  onDone: () => void
}

export function OrderActionDialog({ action, orderCode, onClose, run, onDone }: Props) {
  return (
    <Dialog
      open={action !== null}
      title={action ? ACTION_COPY[action].title : ''}
      onClose={onClose}
    >
      {action ? (
        <ActionBody
          key={action}
          action={action}
          orderCode={orderCode}
          onClose={onClose}
          run={run}
          onDone={onDone}
        />
      ) : null}
    </Dialog>
  )
}

function ActionBody({
  action,
  orderCode,
  onClose,
  run,
  onDone,
}: Omit<Props, 'action'> & { action: OrderAction }) {
  const copy = ACTION_COPY[action]
  const needsReason = ORDER_ACTION_RULES[action].needsReason
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => run(action, needsReason ? reason.trim() : undefined),
    onSuccess: onDone,
  })

  function submit() {
    if (needsReason && reason.trim() === '') {
      setReasonError('Vui lòng nhập lý do.')
      return
    }
    setReasonError(null)
    mutation.mutate()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-slate-800">{copy.consequence(orderCode)}</p>
      {needsReason ? (
        <TextAreaField
          label={copy.reasonLabel ?? 'Lý do'}
          value={reason}
          error={reasonError ?? undefined}
          onChange={(e) => setReason(e.target.value)}
        />
      ) : null}
      {mutation.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(mutation.error as { code?: string; message?: string })}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Quay lại
        </Button>
        <Button type="button" loading={mutation.isPending} onClick={submit}>
          {copy.confirm}
        </Button>
      </div>
    </div>
  )
}
