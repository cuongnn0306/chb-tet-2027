import { Button } from '@/components/ui/Button'
import { customerDisplayName } from '@/domain/customers/validation'
import { describeHistory } from '@/domain/customers/history'
import type { Customer, CustomerHistory } from '@/services/customers.service'

interface Props {
  matches: Customer[]
  /** CUS-005 history per customer id ("3 đơn · 4.800.000 ₫"). */
  history?: Map<string, CustomerHistory>
  /** Label of the action that picks an existing customer ("Dùng khách này" in order entry). */
  useLabel: string
  onUse: (customer: Customer) => void
  /** "Vẫn tạo khách mới": hides the suggestion without blocking anything (PRD §5.3). */
  onDismiss: () => void
}

/** Wireframe 04: non-blocking "this customer may already exist" suggestion. */
export function DuplicateSuggestion({ matches, history, useLabel, onUse, onDismiss }: Props) {
  if (matches.length === 0) return null
  return (
    <div
      role="region"
      aria-label="Khách hàng có thể đã tồn tại"
      className="rounded-md border border-amber-300 bg-amber-50 p-3"
    >
      <p className="font-medium text-amber-900">Khách hàng này có thể đã tồn tại</p>
      <ul className="mt-2 flex flex-col gap-2">
        {matches.map((customer) => (
          <li
            key={customer.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded bg-white p-2"
          >
            <div className="min-w-0 text-sm">
              <p className="font-medium text-slate-900">{customerDisplayName(customer)}</p>
              <p className="text-slate-600">
                {[
                  customer.phone,
                  customer.customer_type === 'COMPANY' ? customer.tax_code : customer.address,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {history ? (
                <p className="text-slate-600">{describeHistory(history.get(customer.id))}</p>
              ) : null}
            </div>
            <Button type="button" variant="secondary" onClick={() => onUse(customer)}>
              {useLabel}
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end">
        <Button type="button" variant="secondary" onClick={onDismiss}>
          Vẫn tạo khách mới
        </Button>
      </div>
    </div>
  )
}
