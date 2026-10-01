import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { DateTimeText } from '@/components/shared/MoneyText'
import { LoadingState } from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import { CheckboxField } from '@/components/ui/fields'
import { Dialog } from '@/components/ui/Dialog'
import { coverageText, holdRemainingText, shortageMessage } from '@/domain/inventory/shortage'
import type { OrderStatus } from '@/domain/orders/state-machine'
import { describeDbError } from '@/lib/db-errors'
import type { AllocationResult } from '@/services/orders.service'
import { useOrderService } from '../hooks/useOrderService'

/** Statuses in which the stock situation is still meaningful (a closed order holds nothing). */
const ACTIVE_STATUSES: OrderStatus[] = [
  'DRAFT',
  'WAITING_CONFIRMATION',
  'WAITING_DEPOSIT',
  'CONFIRMED',
  'RESERVED',
]

interface Props {
  orderId: string
  orderCode: string
  status: OrderStatus
  /** Admin only in the UI; the database also lets Warehouse allocate. */
  canAllocate: boolean
  onAllocated: () => void
}

/** RES-001/007/009/010: what is held for the order, what is missing, where to get it, and FEFO allocation. */
export function OrderStockPanel({ orderId, orderCode, status, canAllocate, onAllocated }: Props) {
  const service = useOrderService()
  const queryClient = useQueryClient()
  const [allocating, setAllocating] = useState(false)
  const [belowSafety, setBelowSafety] = useState(false)
  const [result, setResult] = useState<AllocationResult | null>(null)

  const enabled = ACTIVE_STATUSES.includes(status)
  const stock = useQuery({
    queryKey: ['order-stock', orderId, status],
    queryFn: () => service.stockStatus(orderId),
    enabled,
  })

  const allocate = useMutation({
    mutationFn: () => service.allocate(orderId, belowSafety),
    onSuccess: (data) => {
      setResult(data)
      void queryClient.invalidateQueries({ queryKey: ['order-stock', orderId] })
      onAllocated()
    },
  })

  if (!enabled) return null

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 print:hidden">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Tình trạng hàng</h2>
        {canAllocate && status === 'CONFIRMED' ? (
          <Button
            onClick={() => {
              setResult(null)
              setBelowSafety(false)
              allocate.reset()
              setAllocating(true)
            }}
          >
            Phân bổ hàng
          </Button>
        ) : null}
      </div>

      {status === 'WAITING_DEPOSIT' && stock.data?.reservation_expires_at ? (
        <p className="mb-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
          Hàng đang được giữ tạm đến <DateTimeText value={stock.data.reservation_expires_at} /> (
          {holdRemainingText(stock.data.reservation_expires_at)}). Quá hạn mà chưa nhận cọc, hàng sẽ
          tự động được giải phóng; đơn vẫn giữ ở “Chờ cọc”.
        </p>
      ) : null}
      {status === 'CONFIRMED' ? (
        <p className="mb-2 rounded-md bg-blue-50 p-2 text-sm text-blue-900">
          Đơn đã xác nhận là nhu cầu cam kết: chưa khóa hàng thật. Hàng sẽ được phân bổ khi gần ngày
          giao.
        </p>
      ) : null}

      {stock.isPending ? <LoadingState /> : null}
      {stock.isError ? (
        <p className="text-sm text-red-700">Không tải được tình trạng hàng.</p>
      ) : null}
      {stock.data ? (
        <ul className="flex flex-col gap-2">
          {stock.data.lines.map((line) => {
            const message = shortageMessage(line)
            return (
              <li
                key={line.order_item_id ?? line.product_id}
                className="rounded-md border border-slate-100 p-2 text-sm"
              >
                <p className="font-medium text-slate-900">
                  {line.name} <span className="font-mono text-xs text-slate-500">{line.sku}</span> ×{' '}
                  {line.quantity}
                </p>
                <p className="text-slate-700">{coverageText(line)}</p>
                {message ? (
                  <p className="mt-1 rounded bg-amber-50 p-2 text-amber-900">{message}</p>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      <Dialog open={allocating} title="Phân bổ hàng cho đơn" onClose={() => setAllocating(false)}>
        {allocating ? (
          <div className="flex flex-col gap-4">
            {result ? (
              <div className="flex flex-col gap-2">
                <p
                  className={`rounded-md p-3 text-sm ${result.fully_allocated ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}
                >
                  {result.fully_allocated
                    ? 'Đã phân bổ đủ hàng. Đơn chuyển sang “Giữ hàng”.'
                    : `Mới phân bổ được một phần: còn thiếu ${result.shortage_total.toLocaleString('vi-VN')} cái. Đơn giữ trạng thái “Đã xác nhận”; xem gợi ý chuyển kho ở phần Tình trạng hàng.`}
                </p>
                <div className="flex justify-end">
                  <Button onClick={() => setAllocating(false)}>Đóng</Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-slate-800">
                  Phân bổ hàng cho đơn {orderCode}? Hệ thống tự chọn lô có hạn sử dụng gần nhất
                  (FEFO) và có thể lấy từ nhiều lô; không phá mức tồn an toàn. Nếu chưa đủ hàng, đơn
                  vẫn là “Đã xác nhận” và hiện số lượng còn thiếu. Thao tác được lưu Audit Log.
                </p>
                <CheckboxField
                  label="Cho phép dùng cả tồn an toàn (chỉ Admin)"
                  checked={belowSafety}
                  onChange={setBelowSafety}
                />
                {allocate.isError ? (
                  <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                    {describeDbError(allocate.error as { code?: string; message?: string })}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setAllocating(false)}>
                    Quay lại
                  </Button>
                  <Button loading={allocate.isPending} onClick={() => allocate.mutate()}>
                    Phân bổ hàng
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </Dialog>
    </section>
  )
}
