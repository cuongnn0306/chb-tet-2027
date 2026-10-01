import { useQuery } from '@tanstack/react-query'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { MIN_DUPLICATE_PHONE_LENGTH, normalizePhone } from '@/lib/phone'
import type { Customer } from '@/services/customers.service'
import { useCustomerService } from './useCustomerService'

/**
 * CUS-004: customers that may be the same person/company (same phone or tax code).
 * Debounced; only searches once the phone has enough digits or a tax code is entered.
 */
export function useSimilarCustomers(params: {
  phone: string
  taxCode: string
  excludeId?: string
}): Customer[] {
  const service = useCustomerService()
  const debouncedPhone = useDebouncedValue(params.phone)
  const debouncedTax = useDebouncedValue(params.taxCode)

  const phoneDigits = normalizePhone(debouncedPhone) ?? ''
  const usablePhone = phoneDigits.length >= MIN_DUPLICATE_PHONE_LENGTH
  const usableTax = debouncedTax.trim() !== ''

  const query = useQuery({
    queryKey: ['similar-customers', phoneDigits, debouncedTax.trim(), params.excludeId ?? null],
    queryFn: () =>
      service.findSimilar({
        phone: usablePhone ? debouncedPhone : undefined,
        taxCode: usableTax ? debouncedTax : undefined,
        excludeId: params.excludeId,
      }),
    enabled: usablePhone || usableTax,
  })
  return query.data ?? []
}
