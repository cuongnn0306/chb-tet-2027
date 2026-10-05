import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ErrorState, LoadingState } from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { CheckboxField } from '@/components/ui/fields'
import { allocationOutcomeMessage } from '@/domain/deliveries/deliveries'
import { shortageMessage } from '@/domain/inventory/shortage'
import { describeDbError } from '@/lib/db-errors'
import type { DeliveryAllocationResult } from '@/services/deliveries.service'
import { useDeliveryService } from '../hooks/useDeliveryService'

type DbErr = { code?: string; message?: string }

interface Props {
  deliveryId: string | null
  deliveryCode: string
  /** Only Admin may dip into safety stock (the database re-checks). */
  isAdmin: boolean
  onClose: () => void
  /** Called after a change so the lists behind the dialog can refresh; the dialog stays open. */
  onChanged: () => void
}

/** DEL-005: reserve stock for one delivery at its own source warehouse (Admin / Warehouse). */
export function DeliveryAllocationDialog({ deliveryId, deliveryCode, ...rest }: Props) {
  return (
    <Dialog
      open={deliveryId !== null}
      title={`Phân bổ hàng · ${deliveryCode}`}
      onClose={rest.onClose}
    >
      {deliveryId ? <Body key={deliveryId} deliveryId={deliveryId} {...rest} /> : null}
    </Dialog>
  )
}

function Body({
  deliveryId,
  isAdmin,
  onClose,
  onChanged,
}: Omit<Props, 'deliveryId' | 'deliveryCode'> & { deliveryId: string }) {
  const service = useDeliveryService()
  const [belowSafety, setBelowSafety] = useState(false)
  const [result, setResult] = useState<DeliveryAllocationResult | null>(null)

  const status = useQuery({
    queryKey: ['delivery-allocation', deliveryId],
    queryFn: () => service.allocationStatus(deliveryId),
  })
  const allocate = useMutation({
    mutationFn: () => service.allocate(deliveryId, belowSafety),
    onSuccess: (data) => {
      setResult(data)
      void status.refetch()
      onChanged()
    },
  })

  if (status.isPending) return <LoadingState />
  if (status.isError) {
    return (
      <ErrorState
        title="Không tải được tình trạng phân bổ"
        action={{ label: 'Thử lại', onClick: () => void status.refetch() }}
      >
        {describeDbError(status.error as DbErr)}
      </ErrorState>
    )
  }

  const data = status.data
  const outcome = result ? allocationOutcomeMessage(result, data.source_location.code) : null

  return (
    <div className="flex flex-col gap-4">
      <p className="text-slate-800">
        Giữ hàng tại kho xuất <strong>{data.source_location.name}</strong> đúng cho đợt giao này, lô
        hết hạn sớm nhất trước. Đợt giao khác của đơn không bị ảnh hưởng. Hàng đơn đang giữ thừa ở
        kho khác sẽ được giải phóng; hàng đã giao không bị đụng tới. Thao tác được lưu Audit Log.
      </p>

      <ul className="flex flex-col gap-2">
        {data.lines.map((line) => {
          const message = shortageMessage(line)
          return (
            <li key={line.order_item_id} className="rounded-md border border-slate-200 p-2 text-sm">
              <p className="font-medium text-slate-900">
                {line.name} <span className="font-mono text-xs text-slate-500">{line.sku}</span> ×{' '}
                {line.delivery_quantity}
              </p>
              <p className="text-slate-700">
                {line.quantity === 0
                  ? 'Đã giữ đủ hàng cho đợt này.'
                  : `Đã giữ ${line.covered_for_delivery}/${line.delivery_quantity}, cần giữ thêm ${line.quantity}.`}
              </p>
              {line.held_elsewhere.map((h) => (
                <p key={h.location_id} className="text-slate-600">
                  Đơn đang giữ {h.quantity} tại {h.name}
                  {h.releasable > 0 ? ` (có thể chuyển ${h.releasable})` : ''}.
                </p>
              ))}
              {message ? (
                <p className="mt-1 rounded bg-amber-50 p-2 text-amber-900">{message}</p>
              ) : null}
            </li>
          )
        })}
      </ul>

      {isAdmin && !data.fully_covered ? (
        <CheckboxField
          label="Cho phép dùng cả tồn an toàn (chỉ Admin)"
          checked={belowSafety}
          onChange={setBelowSafety}
        />
      ) : null}
      {outcome ? (
        <p
          role="status"
          className={`rounded-md p-3 text-sm ${outcome.tone === 'success' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}
        >
          {outcome.text}
        </p>
      ) : null}
      {allocate.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(allocate.error as DbErr)}
        </p>
      ) : null}
      {!data.can_allocate ? (
        <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
          Đợt giao hoặc đơn hàng đang ở trạng thái không thể phân bổ thêm hàng.
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Đóng
        </Button>
        {data.can_allocate && !data.fully_covered ? (
          <Button loading={allocate.isPending} onClick={() => allocate.mutate()}>
            Phân bổ hàng cho đợt này
          </Button>
        ) : null}
      </div>
    </div>
  )
}
