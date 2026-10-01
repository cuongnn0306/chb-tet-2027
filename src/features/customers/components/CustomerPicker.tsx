import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import { customerDisplayName } from '@/domain/customers/validation'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type { Customer } from '@/services/customers.service'
import { useCustomerService } from '../hooks/useCustomerService'
import { CustomerForm } from './CustomerForm'

interface Props {
  value: Customer | null
  onChange: (customer: Customer | null) => void
  error?: string
}

/**
 * Order-entry customer step (PRD B11.1): type a phone or name, pick a match, or create a new
 * customer. A new customer's phone triggers the non-blocking duplicate suggestion.
 */
export function CustomerPicker({ value, onChange, error }: Props) {
  const service = useCustomerService()
  const [text, setText] = useState('')
  const [creating, setCreating] = useState(false)
  const debounced = useDebouncedValue(text)
  const enabled = debounced.trim().length >= 2

  const matches = useQuery({
    queryKey: ['customer-picker', debounced.trim()],
    queryFn: () => service.search({ query: debounced.trim(), limit: 8 }),
    enabled,
  })

  if (value) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-900">{customerDisplayName(value)}</p>
          <p className="text-sm text-slate-600">
            {[value.phone, value.customer_type === 'COMPANY' ? value.tax_code : value.address]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={() => onChange(null)}>
          Đổi khách
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Khách hàng (nhập SĐT hoặc tên)"
        type="search"
        autoComplete="off"
        value={text}
        error={error}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ví dụ: 0901234567 hoặc Nguyễn A"
      />
      {enabled && matches.isPending ? <p className="text-sm text-slate-500">Đang tìm…</p> : null}
      {enabled && matches.isError ? (
        <p role="alert" className="text-sm text-red-700">
          Không tìm được khách hàng. Vui lòng thử lại.
        </p>
      ) : null}
      {matches.data && matches.data.length > 0 ? (
        <ul className="flex flex-col divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {matches.data.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(customer)
                  setText('')
                }}
                className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="font-medium text-slate-900">{customerDisplayName(customer)}</span>
                <span className="text-sm text-slate-600">
                  {[
                    customer.phone,
                    customer.customer_type === 'COMPANY' ? customer.tax_code : customer.address,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {enabled && matches.data && matches.data.length === 0 ? (
        <p className="text-sm text-slate-600">Chưa có khách hàng phù hợp.</p>
      ) : null}
      <div>
        <Button type="button" variant="secondary" onClick={() => setCreating(true)}>
          + Tạo khách mới
        </Button>
      </div>

      <Dialog open={creating} title="Thêm khách hàng" onClose={() => setCreating(false)}>
        {creating ? (
          <CustomerForm
            customer={null}
            existingLabel="Dùng khách này"
            onCancel={() => setCreating(false)}
            onSaved={(saved) => {
              setCreating(false)
              onChange(saved)
            }}
            onOpenExisting={(existing) => {
              setCreating(false)
              onChange(existing)
            }}
          />
        ) : null}
      </Dialog>
    </div>
  )
}
