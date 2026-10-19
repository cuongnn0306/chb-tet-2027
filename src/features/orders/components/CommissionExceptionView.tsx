import type { FormEvent } from 'react'
import { DateTimeText, MoneyText } from '@/components/shared/MoneyText'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoPermissionState,
} from '@/components/shared/PageState'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/Button'
import { TextAreaField } from '@/components/ui/fields'
import type { OrderCommissionEstimate } from '@/services/orders.service'
import { hasPendingException } from '../commission-exception'

export type CommissionExceptionState =
  | { kind: 'loading' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'noPermission' }
  | { kind: 'ready'; estimate: OrderCommissionEstimate }

interface Props {
  state: CommissionExceptionState
  isAdmin: boolean
  reason: string
  onReasonChange: (value: string) => void
  onSubmit: () => void
  submitting: boolean
  /** Result of the last approval attempt (success, repeat or failure). */
  notice: { tone: 'success' | 'error'; message: string } | null
  /** Validation message for the reason field. */
  reasonError: string | null
}

/**
 * Presentational only: every state comes in through props so it can be rendered with fixture data.
 * The reason and the approval form exist for Admin only; a salesperson sees the figures and the lock.
 */
export function CommissionExceptionView(props: Props) {
  const { state } = props
  if (state.kind === 'loading') return <LoadingState label="Đang tải hoa hồng…" />
  if (state.kind === 'error') {
    return (
      <ErrorState
        title="Không tải được thông tin hoa hồng"
        action={{ label: 'Thử lại', onClick: state.onRetry }}
      >
        Vui lòng kiểm tra kết nối mạng rồi thử lại.
      </ErrorState>
    )
  }
  if (state.kind === 'noPermission') {
    return (
      <NoPermissionState title="Bạn không xem được hoa hồng của đơn này">
        Chỉ Admin và người phụ trách đơn xem được hoa hồng.
      </NoPermissionState>
    )
  }

  const { estimate } = state
  const exception = estimate.exception
  if (!exception) {
    return (
      <section
        className="rounded-lg border border-slate-200 bg-white p-4 print:hidden"
        aria-label="Hoa hồng và ngoại lệ chiết khấu"
      >
        <EmptyState title="Không có ngoại lệ chiết khấu">
          Chiết khấu của đơn nằm trong hoa hồng gốc nên hoa hồng được tính bình thường, không cần
          Admin duyệt.
        </EmptyState>
      </section>
    )
  }

  const pending = hasPendingException(estimate)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    props.onSubmit()
  }

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-4 print:hidden"
      aria-label="Hoa hồng và ngoại lệ chiết khấu"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-slate-900">Ngoại lệ chiết khấu hoa hồng</h2>
        <StatusBadge
          label={pending ? 'Đang khóa hoa hồng' : 'Đã duyệt'}
          tone={pending ? 'warning' : 'success'}
        />
      </div>

      <p className="mb-3 text-sm text-slate-800">
        Chiết khấu của khách lớn hơn hoa hồng gốc đã chốt khi đơn được xác nhận. Đơn vẫn hợp lệ và
        tiền đã thu không bị ảnh hưởng.
        {pending
          ? ' Hoa hồng của đơn bị khóa cho đến khi Admin duyệt ngoại lệ.'
          : ' Admin đã duyệt, hoa hồng của đơn đã được mở khóa.'}
      </p>

      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt className="break-words">Hoa hồng gốc đã chốt</dt>
        <dd className="text-right">
          <MoneyText amount={estimate.base_commission ?? 0} />
        </dd>
        <dt className="break-words">Chiết khấu của khách</dt>
        <dd className="text-right">
          <MoneyText amount={estimate.discount_amount} />
        </dd>
        <dt className="break-words">Công ty chịu phần vượt</dt>
        <dd className="text-right">
          <MoneyText amount={exception.company_borne_excess} />
        </dd>
        <dt className="break-words font-semibold">Hoa hồng nhân viên được nhận</dt>
        <dd className="text-right font-semibold">
          <MoneyText amount={estimate.final_commission ?? 0} />
        </dd>
        <dt className="break-words">Trạng thái hoa hồng</dt>
        <dd className="text-right">{pending ? 'Đang khóa, chờ Admin duyệt' : 'Đã mở khóa'}</dd>
        {!pending && exception.approved_at ? (
          <>
            <dt className="break-words">Duyệt lúc</dt>
            <dd className="text-right">
              <DateTimeText value={exception.approved_at} />
            </dd>
          </>
        ) : null}
      </dl>

      {props.isAdmin && !pending && exception.approval_reason ? (
        <p className="mt-3 break-words rounded-md bg-slate-50 p-3 text-sm text-slate-800">
          <span className="text-slate-600">Lý do duyệt: </span>
          {exception.approval_reason}
        </p>
      ) : null}

      {props.notice ? (
        <p
          role={props.notice.tone === 'error' ? 'alert' : 'status'}
          className={`mt-3 rounded-md p-3 text-sm ${
            props.notice.tone === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'
          }`}
        >
          {props.notice.message}
        </p>
      ) : null}

      {pending && !props.isAdmin ? (
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          Admin sẽ xem xét và duyệt ngoại lệ này. Bạn không cần làm gì thêm.
        </p>
      ) : null}

      {pending && props.isAdmin ? (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4">
          <p className="text-sm text-slate-800">
            Khi duyệt, hoa hồng của đơn được mở khóa. Công ty chịu phần chiết khấu vượt hoa hồng và
            hoa hồng nhân viên không thể thấp hơn 0. Việc duyệt được lưu Audit Log kèm lý do và
            không hoàn tác được.
          </p>
          <TextAreaField
            label="Lý do duyệt ngoại lệ (bắt buộc)"
            rows={3}
            className="w-full font-sans"
            value={props.reason}
            onChange={(e) => props.onReasonChange(e.target.value)}
            error={props.reasonError ?? undefined}
            required
          />
          <Button type="submit" loading={props.submitting} className="w-full sm:w-auto">
            Duyệt ngoại lệ và mở khóa hoa hồng
          </Button>
        </form>
      ) : null}
    </section>
  )
}
