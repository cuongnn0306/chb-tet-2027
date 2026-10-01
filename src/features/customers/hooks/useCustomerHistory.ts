import { useQuery } from '@tanstack/react-query'
import type { CustomerHistory } from '@/services/customers.service'
import { useCustomerService } from './useCustomerService'

/** CUS-005: purchase history for the given customers (empty map while loading or if unavailable). */
export function useCustomerHistory(ids: string[]): Map<string, CustomerHistory> {
  const service = useCustomerService()
  const sorted = [...ids].sort()
  const query = useQuery({
    queryKey: ['customer-history', sorted],
    queryFn: () => service.orderSummaries(sorted),
    enabled: sorted.length > 0,
  })
  return query.data ?? new Map()
}
