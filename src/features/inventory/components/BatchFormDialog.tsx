import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { SelectField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import { validateBatch } from '@/domain/inventory/validation'
import { normalizeCode, type FieldErrors } from '@/domain/master-data/validation'
import { describeDbError } from '@/lib/db-errors'
import type { Option } from '@/services/lookups.service'
import { useInventoryService } from '../hooks/useInventoryService'

interface Props {
  open: boolean
  products: Option[]
  onClose: () => void
  onCreated: () => void
}

/** INV-001: create a batch (code + manufacture and expiry dates). */
export function BatchFormDialog({ open, products, onClose, onCreated }: Props) {
  return (
    <Dialog open={open} title="Tạo lô hàng" onClose={onClose}>
      {open ? <BatchForm products={products} onClose={onClose} onCreated={onCreated} /> : null}
    </Dialog>
  )
}

function BatchForm({ products, onClose, onCreated }: Omit<Props, 'open'>) {
  const service = useInventoryService()
  const [productId, setProductId] = useState('')
  const [batchCode, setBatchCode] = useState('')
  const [manufacturedDate, setManufacturedDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})

  const mutation = useMutation({
    mutationFn: () =>
      service.createBatch({
        productId,
        batchCode: normalizeCode(batchCode),
        manufacturedDate,
        expiryDate,
      }),
    onSuccess: onCreated,
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    const found = validateBatch({ productId, batchCode, manufacturedDate, expiryDate })
    setErrors(found)
    if (Object.keys(found).length === 0) mutation.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <SelectField
        label="Sản phẩm"
        placeholder="Chọn sản phẩm…"
        options={products}
        value={productId}
        error={errors.product}
        onChange={(e) => setProductId(e.target.value)}
      />
      <TextField
        label="Mã lô"
        value={batchCode}
        error={errors.batch_code}
        hint="Chữ không dấu, số, - hoặc _. Mỗi sản phẩm không trùng mã lô."
        onChange={(e) => setBatchCode(e.target.value)}
      />
      <TextField
        label="Ngày sản xuất"
        type="date"
        value={manufacturedDate}
        error={errors.manufactured_date}
        onChange={(e) => setManufacturedDate(e.target.value)}
      />
      <TextField
        label="Hạn sử dụng"
        type="date"
        value={expiryDate}
        error={errors.expiry_date}
        onChange={(e) => setExpiryDate(e.target.value)}
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
          Tạo lô
        </Button>
      </div>
    </form>
  )
}
