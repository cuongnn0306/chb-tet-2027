import { useMemo } from 'react'
import { getSupabase } from '@/lib/supabase'
import { createOrderService, type OrderService } from '@/services/orders.service'

export function useOrderService(): OrderService {
  return useMemo(() => createOrderService(getSupabase()), [])
}
