import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/fields'
import { TextField } from '@/components/ui/TextField'
import {
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  validateCustomer,
  type CustomerFields,
} from '@/domain/customers/validation'
import type { FieldErrors } from '@/domain/master-data/validation'
import { describeDbError } from '@/lib/db-errors'
import type { Customer } from '@/services/customers.service'
import { customerToFields } from '../customer-fields'
import { useCustomerService } from '../hooks/useCustomerService'
import { useCustomerHistory } from '../hooks/useCustomerHistory'
import { useSimilarCustomers } from '../hooks/useSimilarCustomers'
import { DuplicateSuggestion } from './DuplicateSuggestion'

interface Props {
  customer: Customer | null
  onCancel: () => void
  onSaved: (customer: Customer) => void
  /** Open another (possibly duplicate) customer instead of creating a new one. */
  onOpenExisting: (customer: Customer) => void
  /** Label of the suggestion action: "Xem khách này" in the customer list, "Dùng khách này" in order entry. */
  existingLabel?: string
}

export function CustomerForm({
  customer,
  onCancel,
  onSaved,
  onOpenExisting,
  existingLabel = 'Xem khách này',
}: Props) {
  const service = useCustomerService()
  const [fields, setFields] = useState<CustomerFields>(() => customerToFields(customer))
  const [errors, setErrors] = useState<FieldErrors>({})
  // Dismissal is remembered per phone/tax value, so a new value shows the suggestion again.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)

  const company = fields.customerType === 'COMPANY'
  const similar = useSimilarCustomers({
    phone: fields.phone,
    taxCode: company ? fields.taxCode : '',
    excludeId: customer?.id,
  })
  const similarHistory = useCustomerHistory(similar.map((c) => c.id))
  const similarKey = `${fields.phone}|${company ? fields.taxCode : ''}`

  const mutation = useMutation({
    mutationFn: () => (customer ? service.update(customer.id, fields) : service.create(fields)),
    onSuccess: onSaved,
  })

  const set = (name: keyof CustomerFields) => (value: string) =>
    setFields((current) => ({ ...current, [name]: value }))

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const found = validateCustomer(fields)
    setErrors(found)
    if (Object.keys(found).length === 0) mutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
      <SelectField
        label="Loại khách"
        options={CUSTOMER_TYPES.map((value) => ({ value, label: CUSTOMER_TYPE_LABELS[value] }))}
        error={errors.customer_type}
        value={fields.customerType}
        onChange={(e) => set('customerType')(e.target.value)}
      />

      {company ? (
        <>
          <TextField
            label="Tên công ty"
            error={errors.company_name}
            value={fields.companyName}
            onChange={(e) => set('companyName')(e.target.value)}
          />
          <TextField
            label="Mã số thuế"
            inputMode="numeric"
            error={errors.tax_code}
            value={fields.taxCode}
            onChange={(e) => set('taxCode')(e.target.value)}
          />
          <TextField
            label="Người liên hệ"
            value={fields.contactName}
            onChange={(e) => set('contactName')(e.target.value)}
          />
          <TextField
            label="Chức vụ"
            value={fields.contactTitle}
            onChange={(e) => set('contactTitle')(e.target.value)}
          />
        </>
      ) : (
        <TextField
          label="Tên khách hàng"
          error={errors.name}
          value={fields.name}
          onChange={(e) => set('name')(e.target.value)}
        />
      )}

      <TextField
        label="Số điện thoại"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        error={errors.phone}
        hint="Dùng để tìm và gợi ý khách đã có. Có thể nhập 0901 234 567 hoặc +84 901 234 567."
        value={fields.phone}
        onChange={(e) => set('phone')(e.target.value)}
      />

      {dismissedFor !== similarKey ? (
        <DuplicateSuggestion
          matches={similar}
          history={similarHistory}
          useLabel={existingLabel}
          onUse={onOpenExisting}
          onDismiss={() => setDismissedFor(similarKey)}
        />
      ) : null}

      {company ? (
        <>
          <TextField
            label="Email"
            type="email"
            inputMode="email"
            error={errors.email}
            value={fields.email}
            onChange={(e) => set('email')(e.target.value)}
          />
          <TextField
            label="Địa chỉ công ty"
            value={fields.companyAddress}
            onChange={(e) => set('companyAddress')(e.target.value)}
          />
        </>
      ) : (
        <TextField
          label="Địa chỉ"
          value={fields.address}
          onChange={(e) => set('address')(e.target.value)}
        />
      )}

      {mutation.isError ? (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {describeDbError(mutation.error as { code?: string })}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Hủy
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Lưu
        </Button>
      </div>
    </form>
  )
}
