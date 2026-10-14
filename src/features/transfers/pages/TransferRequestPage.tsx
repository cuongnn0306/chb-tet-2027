import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ROUTES } from '@/app/routes'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/PageState'
import { Button } from '@/components/ui/Button'
import { SelectField, TextAreaField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import {
  MAX_TRANSFER_REASON_LENGTH,
  parseTransferQuantity,
  validateTransferRequest,
  type TransferRequestErrors,
  type TransferRequestInput,
} from '@/domain/transfers/transfers'
import { useAuth } from '@/features/auth/auth-context'
import { describeDbError } from '@/lib/db-errors'
import type { TransferFormOptions } from '@/services/transfers.service'
import { TransferSourceRecommendations } from '../components/TransferSourceRecommendations'
import { useTransferService } from '../hooks/useTransferService'

/**
 * TRF-001: ask for stock to be moved from one location to another. A request moves no stock, reserves nothing and
 * picks no batch; the Admin decides later. One SKU per request, like wireframe 09.
 */
export function TransferRequestPage() {
  const service = useTransferService()
  const options = useQuery({
    queryKey: ['transfer-form-options'],
    queryFn: () => service.requestOptions(),
  })

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <Link to={ROUTES.transfers} className="text-sm text-green-800 underline">
          ← Danh sách yêu cầu
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">Yêu cầu điều chuyển kho</h1>
        <p className="text-sm text-slate-600">
          Chọn kho cần hàng, sản phẩm và số lượng; hệ thống gợi ý kho xuất để bạn tham khảo. Gửi yêu
          cầu không làm thay đổi tồn kho: Admin sẽ xem xét và duyệt trước khi hàng được chuyển.
        </p>
      </header>

      {options.isPending ? <LoadingState label="Đang tải danh sách kho và sản phẩm…" /> : null}
      {options.isError ? (
        <ErrorState
          title="Không tải được danh sách kho và sản phẩm"
          action={{ label: 'Thử lại', onClick: () => void options.refetch() }}
        >
          Vui lòng kiểm tra kết nối mạng rồi thử lại.
        </ErrorState>
      ) : null}
      {options.isSuccess && options.data.locations.length < 2 ? (
        <EmptyState title="Chưa đủ địa điểm để điều chuyển">
          Cần ít nhất hai địa điểm đang hoạt động. Vui lòng liên hệ Admin để bổ sung danh mục địa
          điểm.
        </EmptyState>
      ) : null}
      {options.isSuccess && options.data.products.length === 0 ? (
        <EmptyState title="Chưa có sản phẩm đang kinh doanh">
          Vui lòng liên hệ Admin để bổ sung danh mục sản phẩm.
        </EmptyState>
      ) : null}
      {options.isSuccess &&
      options.data.locations.length >= 2 &&
      options.data.products.length > 0 ? (
        <TransferRequestForm options={options.data} />
      ) : null}
    </section>
  )
}

function TransferRequestForm({ options }: { options: TransferFormOptions }) {
  const service = useTransferService()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { access } = useAuth()

  // The requester's own location is the usual destination: pre-select it, they can still change it.
  const defaultLocationId = access.status === 'active' ? access.user.defaultLocationId : null
  const [destination, setDestination] = useState(
    options.locations.some((location) => location.value === defaultLocationId)
      ? (defaultLocationId ?? '')
      : '',
  )
  const [source, setSource] = useState('')
  const [productId, setProductId] = useState('')
  const [quantityText, setQuantityText] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<TransferRequestErrors | null>(null)

  const mutation = useMutation({
    mutationFn: (input: TransferRequestInput) => service.request(input),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['transfers'] })
      void navigate(`${ROUTES.transferDetail(created.id)}?created=1`)
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (mutation.isPending) return
    const input: TransferRequestInput = {
      sourceLocationId: source,
      destinationLocationId: destination,
      lines: [{ productId, quantity: parseTransferQuantity(quantityText) }],
      reason,
    }
    const result = validateTransferRequest(input)
    setErrors(result.ok ? null : result.errors)
    if (result.ok) mutation.mutate(input)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <SelectField
        label="Kho cần hàng (kho nhận)"
        placeholder="Chọn kho nhận"
        options={options.locations}
        value={destination}
        error={errors?.destination}
        onChange={(e) => {
          setDestination(e.target.value)
          if (e.target.value === source) setSource('')
        }}
      />
      <SelectField
        label="Sản phẩm"
        placeholder="Chọn sản phẩm"
        options={options.products}
        value={productId}
        error={errors?.lines ?? errors?.line[0]?.product}
        onChange={(e) => setProductId(e.target.value)}
      />
      <TextField
        label="Số lượng cần chuyển"
        inputMode="numeric"
        autoComplete="off"
        placeholder="Ví dụ: 30"
        value={quantityText}
        error={errors?.line[0]?.quantity}
        onChange={(e) => setQuantityText(e.target.value)}
      />
      <TransferSourceRecommendations
        destinationLocationId={destination}
        productId={productId}
        quantityText={quantityText}
        selectedLocationId={source}
        onSelect={setSource}
      />
      <SelectField
        label="Kho xuất hàng"
        placeholder="Chọn kho xuất"
        options={options.locations.filter((location) => location.value !== destination)}
        value={source}
        error={errors?.source}
        onChange={(e) => setSource(e.target.value)}
      />
      <TextAreaField
        label="Lý do / ghi chú cho Admin"
        rows={3}
        maxLength={MAX_TRANSFER_REASON_LENGTH}
        placeholder="Ví dụ: Cửa hàng sắp hết hàng, có nhiều đơn giao cuối tuần."
        value={reason}
        error={errors?.reason}
        onChange={(e) => setReason(e.target.value)}
        className="font-sans!"
      />

      {mutation.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(mutation.error as { code?: string; message?: string })}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Link
          to={ROUTES.transfers}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-base text-slate-800 hover:bg-slate-50"
        >
          Quay lại
        </Link>
        <Button type="submit" loading={mutation.isPending} className="w-full sm:w-auto">
          Gửi yêu cầu
        </Button>
      </div>
    </form>
  )
}
