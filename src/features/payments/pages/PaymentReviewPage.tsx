import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { ROUTES } from '@/app/routes'
import { DateTimeText, MoneyText } from '@/components/shared/MoneyText'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextAreaField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import { PAYMENT_METHOD_LABELS } from '@/domain/payments/payments'
import { describeDbError } from '@/lib/db-errors'
import type { PaymentEvent } from '@/services/payments.service'
import { usePaymentService } from '../hooks/usePaymentService'

/** Admin work queue: transfers that were not credited automatically, and payments waiting for confirmation. */
export function PaymentReviewPage() {
  const service = usePaymentService()
  const queryClient = useQueryClient()
  const events = useQuery({
    queryKey: ['payment-events-attention'],
    queryFn: () => service.listEventsNeedingAttention(),
  })
  const pending = useQuery({ queryKey: ['payments-pending'], queryFn: () => service.listPending() })
  const [assigning, setAssigning] = useState<PaymentEvent | null>(null)
  const [dismissing, setDismissing] = useState<PaymentEvent | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['payment-events-attention'] })
    void queryClient.invalidateQueries({ queryKey: ['payments-pending'] })
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Thanh toán cần xử lý</h1>
        <p className="text-sm text-slate-600">
          Tiền khách chuyển mà hệ thống chưa tự ghi nhận được, và các khoản đang chờ xác nhận. Hệ
          thống không bao giờ tự cộng tiền khi không chắc chắn.
        </p>
      </header>

      {notice ? (
        <p role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <h2 className="font-semibold text-slate-900">Giao dịch chưa khớp hoặc cần xem xét</h2>
        {events.isPending ? <LoadingState /> : null}
        {events.isError ? (
          <ErrorState
            title="Không tải được giao dịch"
            action={{ label: 'Thử lại', onClick: () => void events.refetch() }}
          >
            Vui lòng kiểm tra kết nối mạng rồi thử lại.
          </ErrorState>
        ) : null}
        {events.isSuccess && events.data.length === 0 ? (
          <EmptyState title="Không có giao dịch nào cần xử lý" />
        ) : null}
        {events.data?.map((event) => (
          <article
            key={event.id}
            className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-slate-900">
                <MoneyText amount={event.payload.transferAmount ?? 0} /> ·{' '}
                {event.payload.gateway ?? event.provider}
              </p>
              <StatusBadge
                label={event.outcome === 'UNMATCHED' ? 'Chưa khớp đơn' : 'Cần xem xét'}
                tone="warning"
              />
            </div>
            <p className="text-slate-600">
              <DateTimeText value={event.received_at} /> · Mã GD:{' '}
              <span className="font-mono">{event.provider_event_id}</span>
            </p>
            <p className="text-slate-700">
              Nội dung: {event.payload.content ?? event.payload.description ?? '—'}
            </p>
            {event.note ? <p className="text-amber-900">{event.note}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {event.outcome === 'UNMATCHED' ? (
                <Button variant="secondary" onClick={() => setAssigning(event)}>
                  Gán vào đơn
                </Button>
              ) : null}
              {event.order_id ? (
                <Link
                  className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 hover:bg-slate-50"
                  to={ROUTES.orderDetail(event.order_id)}
                >
                  Mở đơn
                </Link>
              ) : null}
              <Button variant="secondary" onClick={() => setDismissing(event)}>
                Đã xử lý
              </Button>
            </div>
          </article>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-semibold text-slate-900">Khoản đang chờ xác nhận</h2>
        {pending.isPending ? <LoadingState /> : null}
        {pending.isSuccess && pending.data.length === 0 ? (
          <EmptyState title="Không có khoản nào đang chờ" />
        ) : null}
        {pending.data?.map((payment) => (
          <article
            key={payment.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm"
          >
            <div>
              <p className="font-medium text-slate-900">
                <MoneyText amount={payment.amount} /> ·{' '}
                {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
              </p>
              <p className="text-slate-600">
                <span className="font-mono">{payment.payment_code}</span> ·{' '}
                <DateTimeText value={payment.created_at} />
              </p>
              {payment.note ? <p className="text-amber-900">{payment.note}</p> : null}
            </div>
            <Link
              className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 hover:bg-slate-50"
              to={ROUTES.orderDetail(payment.order_id)}
            >
              Mở đơn {payment.orders?.order_code}
            </Link>
          </article>
        ))}
      </div>

      <AssignDialog
        event={assigning}
        onClose={() => setAssigning(null)}
        onDone={() => {
          setAssigning(null)
          setNotice('Đã gán giao dịch vào đơn và ghi nhận thanh toán.')
          refresh()
        }}
      />
      <DismissDialog
        event={dismissing}
        onClose={() => setDismissing(null)}
        onDone={() => {
          setDismissing(null)
          setNotice('Đã đánh dấu giao dịch là đã xử lý.')
          refresh()
        }}
      />
    </section>
  )
}

function AssignDialog({
  event,
  onClose,
  onDone,
}: {
  event: PaymentEvent | null
  onClose: () => void
  onDone: () => void
}) {
  return (
    <Dialog open={event !== null} title="Gán giao dịch vào đơn" onClose={onClose}>
      {event ? <AssignForm key={event.id} event={event} onClose={onClose} onDone={onDone} /> : null}
    </Dialog>
  )
}

function AssignForm({
  event,
  onClose,
  onDone,
}: {
  event: PaymentEvent
  onClose: () => void
  onDone: () => void
}) {
  const service = usePaymentService()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: async () => {
      const orderId = await service.findOrderIdByCode(code)
      if (!orderId) throw new Error('NOT_FOUND')
      return service.assignEvent(event.id, orderId)
    },
    onSuccess: onDone,
    onError: (e) =>
      setError(
        e instanceof Error && e.message === 'NOT_FOUND'
          ? 'Không tìm thấy đơn có mã này.'
          : describeDbError(e as { code?: string; message?: string }),
      ),
  })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-slate-800">
        Gán khoản <MoneyText amount={event.payload.transferAmount ?? 0} /> vào đơn bạn chọn? Khoản
        được ghi nhận là đã nhận tiền, cộng vào số đã thanh toán của đơn (nếu đủ cọc, đơn tự động
        xác nhận) và được lưu Audit Log. Số tiền không được vượt số còn phải thu.
      </p>
      <TextField
        label="Mã đơn"
        value={code}
        error={error ?? undefined}
        hint="Ví dụ: TET000123"
        onChange={(e) => setCode(e.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Quay lại
        </Button>
        <Button
          loading={mutation.isPending}
          disabled={code.trim() === ''}
          onClick={() => {
            setError(null)
            mutation.mutate()
          }}
        >
          Gán vào đơn
        </Button>
      </div>
    </div>
  )
}

function DismissDialog({
  event,
  onClose,
  onDone,
}: {
  event: PaymentEvent | null
  onClose: () => void
  onDone: () => void
}) {
  return (
    <Dialog open={event !== null} title="Đánh dấu đã xử lý" onClose={onClose}>
      {event ? (
        <DismissForm key={event.id} event={event} onClose={onClose} onDone={onDone} />
      ) : null}
    </Dialog>
  )
}

function DismissForm({
  event,
  onClose,
  onDone,
}: {
  event: PaymentEvent
  onClose: () => void
  onDone: () => void
}) {
  const service = usePaymentService()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => service.dismissEvent(event.id, note.trim()),
    onSuccess: onDone,
  })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-slate-800">
        Giao dịch này sẽ biến mất khỏi danh sách cần xử lý. Hệ thống không hoàn tiền thay bạn: hãy
        ghi rõ đã xử lý thế nào (ví dụ: đã hoàn tiền cho khách ngày…). Ghi chú được lưu lại.
      </p>
      <TextAreaField
        label="Ghi chú cách đã xử lý"
        value={note}
        error={error ?? undefined}
        onChange={(e) => setNote(e.target.value)}
      />
      {mutation.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(mutation.error as { code?: string; message?: string })}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Quay lại
        </Button>
        <Button
          loading={mutation.isPending}
          onClick={() =>
            note.trim() === '' ? setError('Vui lòng ghi chú.') : (setError(null), mutation.mutate())
          }
        >
          Đã xử lý
        </Button>
      </div>
    </div>
  )
}
