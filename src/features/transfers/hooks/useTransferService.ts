import { useMemo } from 'react'
import { getSupabase } from '@/lib/supabase'
import { createTransferService, type TransferService } from '@/services/transfers.service'

export function useTransferService(): TransferService {
  return useMemo(() => createTransferService(getSupabase()), [])
}
