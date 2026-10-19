import { useMemo } from 'react'
import { getSupabase } from '@/lib/supabase'
import { createDeliveryService, type DeliveryService } from '@/services/deliveries.service'

export function useDeliveryService(): DeliveryService {
  return useMemo(() => createDeliveryService(getSupabase()), [])
}
