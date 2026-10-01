import { useMemo } from 'react'
import { getSupabase } from '@/lib/supabase'
import { createCustomerService, type CustomerService } from '@/services/customers.service'

export function useCustomerService(): CustomerService {
  return useMemo(() => createCustomerService(getSupabase()), [])
}
