import { useMemo } from 'react'
import { getSupabase } from '@/lib/supabase'
import { createInventoryService, type InventoryService } from '@/services/inventory.service'

export function useInventoryService(): InventoryService {
  return useMemo(() => createInventoryService(getSupabase()), [])
}
