import { MoneyText } from '@/components/shared/MoneyText'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/fields'
import type { FieldErrors } from '@/domain/master-data/validation'
import type { LineInput } from '@/domain/orders/form'
import { parseInteger } from '@/domain/master-data/validation'

export interface ProductOption {
  id: string
  sku: string
  name: string
  listPrice: number
}

interface Props {
  products: ProductOption[]
  lines: LineInput[]
  onChange: (lines: LineInput[]) => void
  errors: FieldErrors
}

/** Product + quantity rows with list-price line totals (PRD §25 / B11.3). */
export function OrderLinesEditor({ products, lines, onChange, errors }: Props) {
  const byId = new Map(products.map((product) => [product.id, product]))

  function addProduct(productId: string) {
    if (productId === '') return
    const existing = lines.findIndex((line) => line.productId === productId)
    if (existing >= 0) {
      // Same product again: add one to the existing line instead of duplicating it.
      const current = parseInteger(lines[existing]?.quantity ?? '', { min: 0 })
      onChange(
        lines.map((line, index) =>
          index === existing ? { ...line, quantity: String((current.value ?? 0) + 1) } : line,
        ),
      )
    } else {
      onChange([...lines, { productId, quantity: '1' }])
    }
  }

  function setQuantity(index: number, quantity: string) {
    onChange(lines.map((line, i) => (i === index ? { ...line, quantity } : line)))
  }

  function step(index: number, delta: number) {
    const current = parseInteger(lines[index]?.quantity ?? '', { min: 0 }).value ?? 0
    setQuantity(index, String(Math.max(1, current + delta)))
  }

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Thêm sản phẩm"
        placeholder="Chọn sản phẩm…"
        options={products.map((product) => ({
          value: product.id,
          label: `${product.sku} — ${product.name}`,
        }))}
        value=""
        onChange={(e) => addProduct(e.target.value)}
        error={errors.lines}
      />

      {lines.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {lines.map((line, index) => {
            const product = byId.get(line.productId)
            const quantity = parseInteger(line.quantity, { min: 1 })
            const error = errors[`line:${index}`]
            return (
              <li key={line.productId} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{product?.name ?? 'Sản phẩm'}</p>
                    <p className="text-sm text-slate-600">
                      {product?.sku} · <MoneyText amount={product?.listPrice ?? 0} />
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`Xóa ${product?.name ?? 'sản phẩm'} khỏi đơn`}
                    onClick={() => onChange(lines.filter((_, i) => i !== index))}
                  >
                    Xóa
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label="Giảm số lượng"
                      onClick={() => step(index, -1)}
                    >
                      −
                    </Button>
                    <input
                      aria-label={`Số lượng ${product?.name ?? ''}`}
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(e) => setQuantity(index, e.target.value)}
                      className={`min-h-11 w-20 rounded-md border px-2 text-center text-base ${error ? 'border-red-500' : 'border-slate-300'}`}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      aria-label="Tăng số lượng"
                      onClick={() => step(index, 1)}
                    >
                      +
                    </Button>
                  </div>
                  <MoneyText
                    className="font-medium text-slate-900"
                    amount={
                      quantity.value !== null && product ? product.listPrice * quantity.value : 0
                    }
                  />
                </div>
                {error ? (
                  <p role="alert" className="mt-1 text-sm text-red-700">
                    {error}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
