import { useMemo } from 'react'
import { getSupabase } from '@/lib/supabase'
import { createAuditService, type AuditService } from '@/services/audit.service'

export function useAuditService(): AuditService {
  return useMemo(() => createAuditService(getSupabase()), [])
}
