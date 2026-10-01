import { useMutation } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { SelectField, TextAreaField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import type { ManualExitType } from '@/domain/inventory/movements'
import { validateStockMove } from '@/domain/inventory/validation'
import { parseInteger, type FieldErrors } from '@/domain/master-data/validation'
import { describeDbError } from '@/lib/db-errors'
import type { BatchRow } from '@/services/inventory.service'
import type { Option } from '@/services/lookups.service'
import { useInventoryService } from '../hooks/useInventoryService'

export type StockMoveMode = 'opening' | 'adjust_in' | 'adjust_out' | ManualExitType

interface Copy {
  title: string
  consequence: string
  confirm: string
  reasonRequired: boolean
  reasonLabel: string
}

const COPY: Record<StockMoveMode, Copy> = {
  opening: {
    title: 'Nhập tồn đầu kỳ',
    consequence:
      'Ghi nhận số lượng tồn ban đầu theo kiểm kê. Thao tác tạo một dòng trong sổ kho và được lưu Audit Log.',
    confirm: 'Nhập tồn',
    reasonRequired: false,
    reasonLabel: 'Ghi chú (không bắt buộc)',
  },
  adjust_in: {
    title: 'Điều chỉnh tăng tồn',
    consequence:
      'Tăng tồn khả dụng của lô này. Thao tác tạo một dòng điều chỉnh trong sổ kho, không sửa được sau khi lưu.',
    confirm: 'Điều chỉnh tăng',
    reasonRequired: true,
    reasonLabel: 'Lý do điều chỉnh',
  },
  adjust_out: {
    title: 'Điều chỉnh giảm tồn',
    consequence:
      'Giảm tồn khả dụng của lô này. Không thể giảm quá số đang có và không lấy được hàng đã giữ cho đơn. Không sửa được sau khi lưu.',
    confirm: 'Điều chỉnh giảm',
    reasonRequired: true,
    reasonLabel: 'Lý do điều chỉnh',
  },
  SAMPLE_OUT: {
    title: 'Xuất hàng mẫu',
    consequence: 'Trừ số lượng khỏi tồn khả dụng và ghi vào hàng mẫu. Không sửa được sau khi lưu.',
    confirm: 'Xuất hàng mẫu',
    reasonRequired: true,
    reasonLabel: 'Lý do / nơi nhận',
  },
  GIFT_OUT: {
    title: 'Xuất hàng biếu',
    consequence: 'Trừ số lượng khỏi tồn khả dụng và ghi vào hàng biếu. Không sửa được sau khi lưu.',
    confirm: 'Xuất hàng biếu',
    reasonRequired: true,
    reasonLabel: 'Lý do / người nhận',
  },
  DAMAGE_OUT: {
    title: 'Ghi nhận hàng hỏng/hủy',
    consequence:
      'Trừ số lượng khỏi tồn khả dụng và ghi vào hàng hỏng. Hàng hỏng không bán lại được. Không sửa được sau khi lưu.',
    confirm: 'Ghi nhận hỏng/hủy',
    reasonRequired: true,
    reasonLabel: 'Nguyên nhân hỏng/hủy',
  },
}

export interface StockMovePreset {
  locationId: string
  productId: string
  batchId: string
  /** Shown to the user, e.g. "TT-1200 · Lô B-OLD · HN-BEP". */
  label: string
}

interface Props {
  mode: StockMoveMode | null
  preset: StockMovePreset | null
  locations: Option[]
  products: Option[]
  batches: BatchRow[]
  onClose: () => void
  onDone: (message: string) => void
}

export function StockMoveDialog(props: Props) {
  const { mode, onClose } = props
  return (
    <Dialog open={mode !== null} title={mode ? COPY[mode].title : ''} onClose={onClose}>
      {mode ? (
        <MoveForm key={`${mode}-${props.preset?.batchId ?? 'new'}`} {...props} mode={mode} />
      ) : null}
    </Dialog>
  )
}

function MoveForm({
  mode,
  preset,
  locations,
  products,
  batches,
  onClose,
  onDone,
}: Props & { mode: StockMoveMode }) {
  const service = useInventoryService()
  const copy = COPY[mode]
  const [productId, setProductId] = useState(preset?.productId ?? '')
  const [batchId, setBatchId] = useState(preset?.batchId ?? '')
  const [locationId, setLocationId] = useState(preset?.locationId ?? '')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})

  const batchOptions = useMemo(
    () =>
      batches
        .filter((b) => b.product_id === productId && b.status === 'ACTIVE')
        .map((b) => ({ value: b.id, label: `${b.batch_code} (HSD ${b.expiry_date})` })),
    [batches, productId],
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const qty = parseInteger(quantity, { min: 1 }).value as number
      const base = { locationId, productId, batchId, quantity: qty }
      if (mode === 'opening') return service.recordOpeningStock({ ...base, note: reason })
      if (mode === 'adjust_in' || mode === 'adjust_out') {
        return service.adjust({ ...base, direction: mode === 'adjust_in' ? 'IN' : 'OUT', reason })
      }
      return service.recordExit({ ...base, type: mode, reason })
    },
    onSuccess: () => onDone(`Đã ghi nhận: ${copy.title.toLowerCase()}.`),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    const found = validateStockMove({
      locationId,
      batchId,
      quantity,
      reason,
      reasonRequired: copy.reasonRequired,
    })
    if (productId === '') found.product = 'Vui lòng chọn sản phẩm.'
    setErrors(found)
    if (Object.keys(found).length === 0) mutation.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <p className="text-sm text-slate-700">{copy.consequence}</p>
      {preset ? (
        <p className="rounded-md bg-slate-100 p-2 text-sm font-medium text-slate-900">
          {preset.label}
        </p>
      ) : (
        <>
          <SelectField
            label="Sản phẩm"
            placeholder="Chọn sản phẩm…"
            options={products}
            value={productId}
            error={errors.product}
            onChange={(e) => {
              setProductId(e.target.value)
              setBatchId('')
            }}
          />
          <SelectField
            label="Lô hàng"
            placeholder={productId ? 'Chọn lô…' : 'Chọn sản phẩm trước'}
            options={batchOptions}
            value={batchId}
            error={errors.batch}
            onChange={(e) => setBatchId(e.target.value)}
          />
          <SelectField
            label="Địa điểm"
            placeholder="Chọn địa điểm…"
            options={locations}
            value={locationId}
            error={errors.location}
            onChange={(e) => setLocationId(e.target.value)}
          />
        </>
      )}
      <TextField
        label="Số lượng (cái)"
        inputMode="numeric"
        value={quantity}
        error={errors.quantity}
        onChange={(e) => setQuantity(e.target.value)}
      />
      <TextAreaField
        label={copy.reasonLabel}
        value={reason}
        error={errors.reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {mutation.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(mutation.error as { code?: string; message?: string })}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Quay lại
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {copy.confirm}
        </Button>
      </div>
    </form>
  )
}
