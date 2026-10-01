import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { DateTimeText, MoneyText } from '@/components/shared/MoneyText'
import { LoadingState } from '@/components/shared/PageState'
import { StatusBadge, type BadgeTone } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { CheckboxField, SelectField, TextAreaField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import {
  ORDER_PAYMENT_STATE_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  buildSepayQrUrl,
  orderPaymentState,
  validateRecordPayment,
  type PaymentMethod,
  type PaymentStatus,
} from '@/domain/payments/payments'
import { describeDbError } from '@/lib/db-errors'
import { formatVnd } from '@/lib/money'
import type { Payment } from '@/services/payments.service'
import { useOrderRealtime } from '../hooks/useOrderRealtime'
import { usePaymentService } from '../hooks/usePaymentService'

const STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  FAILED: 'danger',
  REFUNDED: 'muted',
  VOIDED: 'muted',
}

/** Statuses in which the database accepts money (anything else would be sent to review). */
const PAYABLE = new Set([
  'WAITING_CONFIRMATION',
  'WAITING_DEPOSIT',
  'CONFIRMED',
  'RESERVED',
  'PREPARING',
  'WAITING_DELIVERY',
  'COMPLETED',
])

type PaymentAction = 'confirm' | 'fail' | 'void' | 'refund'

const ACTION_COPY: Record<
  PaymentAction,
  { title: string; consequence: string; confirm: string; needsReason: boolean }
> = {
  confirm: {
    title: 'Xác nhận đã nhận tiền',
    consequence:
      'Khoản này sẽ được tính vào số tiền đã thanh toán của đơn. Nếu đã đủ tiền cọc, đơn tự động chuyển sang “Đã xác nhận”. Thao tác được lưu Audit Log.',
    confirm: 'Xác nhận đã nhận',
    needsReason: false,
  },
  fail: {
    title: 'Đánh dấu thất bại',
    consequence:
      'Khoản chờ xác nhận này sẽ đóng lại là “Thất bại” và không tính vào đơn. Không mở lại được.',
    confirm: 'Đánh dấu thất bại',
    needsReason: true,
  },
  void: {
    title: 'Hủy khoản thanh toán',
    consequence:
      'Khoản chờ xác nhận này sẽ bị hủy (không xóa khỏi hệ thống) và không tính vào đơn. Không mở lại được.',
    confirm: 'Hủy khoản này',
    needsReason: true,
  },
  refund: {
    title: 'Hoàn tiền',
    consequence:
      'Khoản đã nhận này được ghi nhận là đã hoàn lại cho khách: số tiền đã thanh toán của đơn giảm tương ứng. Hệ thống không tự chuyển tiền; hãy hoàn tiền cho khách ngoài hệ thống. Không hoàn tác được; thao tác được lưu Audit Log.',
    confirm: 'Ghi nhận hoàn tiền',
    needsReason: true,
  },
}

interface Props {
  orderId: string
  status: string
  isAdmin: boolean
  /** Called after any change (own action or a live update) so the order screen can refresh. */
  onChanged: () => void
}

export function OrderPaymentPanel({ orderId, status, isAdmin, onChanged }: Props) {
  const service = usePaymentService()
  const queryClient = useQueryClient()
  const [recording, setRecording] = useState(false)
  const [action, setAction] = useState<{ type: PaymentAction; payment: Payment } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const instructions = useQuery({
    queryKey: ['payment-instructions', orderId, status],
    queryFn: () => service.instructions(orderId),
  })
  const payments = useQuery({
    queryKey: ['order-payments', orderId],
    queryFn: () => service.list(orderId),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['payment-instructions', orderId] })
    void queryClient.invalidateQueries({ queryKey: ['order-payments', orderId] })
    onChanged()
  }

  useOrderRealtime(orderId, (source) => {
    if (source === 'payment') setNotice('Vừa có cập nhật thanh toán cho đơn này.')
    refresh()
  })

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      setCopied(null)
    }
  }

  if (instructions.isPending || payments.isPending) return <LoadingState />
  if (instructions.isError) return null // not visible to this user

  const info = instructions.data
  const paymentState = orderPaymentState(info)
  const payable = PAYABLE.has(info.status)
  const showQr = payable && info.amount_due > 0

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 print:hidden"
      aria-label="Thanh toán"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          Thanh toán{' '}
          <StatusBadge
            label={ORDER_PAYMENT_STATE_LABELS[paymentState]}
            tone={
              paymentState === 'PAID' ? 'success' : paymentState === 'UNPAID' ? 'neutral' : 'info'
            }
          />
        </h2>
        {isAdmin && payable ? (
          <Button onClick={() => setRecording(true)}>Ghi nhận thanh toán</Button>
        ) : null}
      </div>

      {notice ? (
        <p role="status" className="mb-3 rounded-md bg-green-50 p-2 text-sm text-green-800">
          {notice}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-slate-600">Khách phải trả</dt>
          <dd className="font-medium">
            <MoneyText amount={info.net_amount} />
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Cọc yêu cầu</dt>
          <dd className="font-medium">
            <MoneyText amount={info.deposit_required} />
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Đã thanh toán</dt>
          <dd className="font-medium">
            <MoneyText amount={info.paid_amount} />
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Còn lại</dt>
          <dd className="font-medium">
            <MoneyText amount={info.remaining_amount} />
          </dd>
        </div>
      </dl>

      {showQr ? (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-start">
          {info.configured && info.bank && info.account_no ? (
            <img
              alt={`Mã QR chuyển khoản ${formatVnd(info.amount_due)} nội dung ${info.transfer_content}`}
              width={220}
              height={220}
              className="size-56 rounded-md border border-slate-200"
              src={buildSepayQrUrl({
                bank: info.bank,
                accountNo: info.account_no,
                amount: info.amount_due,
                content: info.transfer_content,
              })}
            />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
            <p className="font-medium text-slate-900">
              {info.status === 'WAITING_DEPOSIT'
                ? 'Khách chuyển tiền cọc'
                : 'Khách chuyển số tiền còn lại'}
            </p>
            {info.configured ? (
              <>
                <p>
                  Ngân hàng: <strong>{info.bank}</strong> · STK:{' '}
                  <strong className="font-mono">{info.account_no}</strong>
                  {info.account_name ? <> · {info.account_name}</> : null}
                </p>
                <p>
                  Số tiền chính xác:{' '}
                  <strong>
                    <MoneyText amount={info.amount_due} />
                  </strong>
                </p>
                <p>
                  Nội dung chuyển khoản (mã thanh toán):{' '}
                  <strong className="font-mono text-base">{info.transfer_content}</strong>
                </p>
                <p className="text-xs text-slate-600">
                  Khách phải ghi đúng nội dung để hệ thống tự nhận tiền. Ảnh QR do SePay cung cấp từ
                  số tài khoản, số tiền và nội dung ở trên.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void copy('code', info.transfer_content)}
                  >
                    {copied === 'code' ? 'Đã sao chép' : 'Sao chép nội dung'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void copy('amount', String(info.amount_due))}
                  >
                    {copied === 'amount' ? 'Đã sao chép' : 'Sao chép số tiền'}
                  </Button>
                </div>
              </>
            ) : (
              <p className="rounded-md bg-amber-50 p-2 text-amber-900">
                Chưa cấu hình tài khoản nhận tiền nên chưa tạo được mã QR.{' '}
                {isAdmin
                  ? 'Vào Danh mục → Cấu hình → “Cấu hình mã QR thanh toán” để thiết lập.'
                  : 'Vui lòng liên hệ Admin.'}{' '}
                Mã thanh toán của đơn:{' '}
                <strong className="font-mono">{info.transfer_content}</strong>
              </p>
            )}
          </div>
        </div>
      ) : null}

      <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-900">Lịch sử thanh toán</h3>
      {payments.data && payments.data.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {payments.data.map((payment) => (
            <li key={payment.id} className="rounded-md border border-slate-100 p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-900">
                  <MoneyText amount={payment.amount} /> ·{' '}
                  {PAYMENT_METHOD_LABELS[payment.method] ?? payment.method}
                </p>
                <StatusBadge
                  label={PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                  tone={STATUS_TONE[payment.status] ?? 'neutral'}
                />
              </div>
              <p className="text-slate-600">
                <span className="font-mono">{payment.payment_code}</span>
                {' · '}
                <DateTimeText value={payment.paid_at ?? payment.created_at} />
                {payment.provider ? ` · ${payment.provider}` : ''}
              </p>
              {payment.transfer_content ? (
                <p className="text-slate-600">Nội dung: {payment.transfer_content}</p>
              ) : null}
              {payment.note ? <p className="text-slate-700">{payment.note}</p> : null}
              {payment.status_reason ? (
                <p className="text-slate-700">Lý do: {payment.status_reason}</p>
              ) : null}
              {isAdmin && payment.status === 'PENDING' ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setAction({ type: 'confirm', payment })}
                  >
                    Xác nhận đã nhận
                  </Button>
                  <Button variant="secondary" onClick={() => setAction({ type: 'void', payment })}>
                    Hủy
                  </Button>
                  <Button variant="secondary" onClick={() => setAction({ type: 'fail', payment })}>
                    Thất bại
                  </Button>
                </div>
              ) : null}
              {isAdmin && payment.status === 'CONFIRMED' ? (
                <div className="mt-2">
                  <Button
                    variant="secondary"
                    onClick={() => setAction({ type: 'refund', payment })}
                  >
                    Hoàn tiền
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">Chưa có khoản thanh toán nào.</p>
      )}

      <RecordPaymentDialog
        open={recording}
        orderId={orderId}
        maxAmount={info.remaining_amount}
        suggestedAmount={info.amount_due}
        onClose={() => setRecording(false)}
        onDone={() => {
          setRecording(false)
          setNotice('Đã ghi nhận thanh toán.')
          refresh()
        }}
      />
      <PaymentActionDialog
        state={action}
        onClose={() => setAction(null)}
        onDone={(message) => {
          setAction(null)
          setNotice(message)
          refresh()
        }}
      />
    </section>
  )
}

function RecordPaymentDialog({
  open,
  orderId,
  maxAmount,
  suggestedAmount,
  onClose,
  onDone,
}: {
  open: boolean
  orderId: string
  maxAmount: number
  suggestedAmount: number
  onClose: () => void
  onDone: () => void
}) {
  return (
    <Dialog open={open} title="Ghi nhận thanh toán" onClose={onClose}>
      {open ? (
        <RecordForm
          orderId={orderId}
          maxAmount={maxAmount}
          suggestedAmount={suggestedAmount}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null}
    </Dialog>
  )
}

function RecordForm({
  orderId,
  maxAmount,
  suggestedAmount,
  onClose,
  onDone,
}: {
  orderId: string
  maxAmount: number
  suggestedAmount: number
  onClose: () => void
  onDone: () => void
}) {
  const service = usePaymentService()
  const [method, setMethod] = useState<string>('CASH')
  const [amount, setAmount] = useState(suggestedAmount > 0 ? String(suggestedAmount) : '')
  const [received, setReceived] = useState(true)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: (value: number) =>
      service.record({ orderId, method: method as PaymentMethod, amount: value, received, note }),
    onSuccess: onDone,
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    const result = validateRecordPayment({ method, amount, received, maxAmount })
    setErrors(result.errors)
    if (result.amount !== null) mutation.mutate(result.amount)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <p className="text-sm text-slate-700">
        Ghi nhận một khoản khách đã/sẽ thanh toán. Khoản đã nhận được cộng vào số tiền đã thanh toán
        của đơn ngay; nếu đủ tiền cọc, đơn tự động chuyển sang “Đã xác nhận”. Thao tác được lưu
        Audit Log.
      </p>
      <SelectField
        label="Phương thức"
        options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
        value={method}
        error={errors.method}
        onChange={(e) => setMethod(e.target.value)}
      />
      <TextField
        label="Số tiền (₫)"
        inputMode="numeric"
        value={amount}
        error={errors.amount}
        hint={`Còn phải thu tối đa ${formatVnd(maxAmount)}.`}
        onChange={(e) => setAmount(e.target.value)}
      />
      <CheckboxField
        label="Đã nhận tiền (bỏ chọn nếu chỉ ghi nhận khoản sẽ thu, ví dụ COD)"
        checked={received}
        onChange={setReceived}
      />
      <TextAreaField
        label="Ghi chú (không bắt buộc)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {mutation.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(mutation.error as { code?: string; message?: string })}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Hủy
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Ghi nhận
        </Button>
      </div>
    </form>
  )
}

function PaymentActionDialog({
  state,
  onClose,
  onDone,
}: {
  state: { type: PaymentAction; payment: Payment } | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  return (
    <Dialog
      open={state !== null}
      title={state ? ACTION_COPY[state.type].title : ''}
      onClose={onClose}
    >
      {state ? (
        <ActionForm
          key={`${state.type}-${state.payment.id}`}
          state={state}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null}
    </Dialog>
  )
}

function ActionForm({
  state,
  onClose,
  onDone,
}: {
  state: { type: PaymentAction; payment: Payment }
  onClose: () => void
  onDone: (message: string) => void
}) {
  const service = usePaymentService()
  const copy = ACTION_COPY[state.type]
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => {
      const id = state.payment.id
      if (state.type === 'confirm') return service.confirm(id)
      if (state.type === 'fail') return service.fail(id, reason.trim())
      if (state.type === 'void') return service.void(id, reason.trim())
      return service.refund(id, reason.trim())
    },
    onSuccess: () => onDone(`Đã thực hiện: ${copy.title.toLowerCase()}.`),
  })

  function submit() {
    if (copy.needsReason && reason.trim() === '') return setError('Vui lòng nhập lý do.')
    setError(null)
    mutation.mutate()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-slate-800">
        {formatVnd(state.payment.amount)} · {state.payment.payment_code}. {copy.consequence}
      </p>
      {copy.needsReason ? (
        <TextAreaField
          label="Lý do"
          value={reason}
          error={error ?? undefined}
          onChange={(e) => setReason(e.target.value)}
        />
      ) : null}
      {mutation.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(mutation.error as { code?: string; message?: string })}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Quay lại
        </Button>
        <Button loading={mutation.isPending} onClick={submit}>
          {copy.confirm}
        </Button>
      </div>
    </div>
  )
}
