import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { isNoPermission, submitApproval, validateApprovalReason } from '../commission-exception'
import { useOrderService } from '../hooks/useOrderService'
import { CommissionExceptionView, type CommissionExceptionState } from './CommissionExceptionView'

/** Statuses an order can still be in before the commission snapshot exists. */
const BEFORE_CONFIRMED = new Set(['DRAFT', 'WAITING_CONFIRMATION', 'WAITING_DEPOSIT'])

interface Props {
  orderId: string
  status: string
  isAdmin: boolean
}

/**
 * Commission lock and Admin approval of a discount exception (COM-002). Data and the approval go through
 * the typed order service / RPC; the view only presents them.
 */
export function CommissionExceptionPanel({ orderId, status, isAdmin }: Props) {
  const service = useOrderService()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const enabled = !BEFORE_CONFIRMED.has(status)
  const estimate = useQuery({
    queryKey: ['order-commission', orderId, status],
    queryFn: () => service.commissionEstimate(orderId),
    enabled,
  })

  const approve = useMutation({
    mutationFn: () => submitApproval(service, orderId, reason),
    onSuccess: (outcome) => {
      if (outcome.kind === 'invalid') {
        setReasonError(outcome.message)
        return
      }
      setReasonError(null)
      if (outcome.kind === 'error') {
        setNotice({ tone: 'error', message: outcome.message })
        return
      }
      setNotice({ tone: 'success', message: outcome.message })
      setReason('')
      // Refresh the estimate: the lock status, the approval time and (for Admin) the stored reason.
      void queryClient.invalidateQueries({ queryKey: ['order-commission', orderId] })
    },
  })

  if (!enabled) return null
  // Nothing to show for an order whose commission is not frozen yet (cancelled before confirmation, legacy gaps).
  if (estimate.data && estimate.data.basis !== 'SNAPSHOT') return null

  let state: CommissionExceptionState
  if (estimate.isPending) state = { kind: 'loading' }
  else if (estimate.isError) {
    state = isNoPermission(estimate.error)
      ? { kind: 'noPermission' }
      : { kind: 'error', onRetry: () => void estimate.refetch() }
  } else state = { kind: 'ready', estimate: estimate.data }

  return (
    <CommissionExceptionView
      state={state}
      isAdmin={isAdmin}
      reason={reason}
      onReasonChange={(value) => {
        setReason(value)
        if (reasonError && !validateApprovalReason(value)) setReasonError(null)
      }}
      onSubmit={() => approve.mutate()}
      submitting={approve.isPending}
      notice={notice}
      reasonError={reasonError}
    />
  )
}
