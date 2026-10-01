import { useMemo } from 'react'
import { getSupabase } from '@/lib/supabase'
import { createPaymentService, type PaymentService } from '@/services/payments.service'

export function usePaymentService(): PaymentService {
  return useMemo(() => createPaymentService(getSupabase()), [])
}
