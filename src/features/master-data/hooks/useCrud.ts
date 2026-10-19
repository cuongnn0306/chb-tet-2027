import { useMemo } from 'react'
import { getSupabase } from '@/lib/supabase'
import { createCrudService, type CrudService, type CrudTable } from '@/services/crud.service'

/** Stable CRUD service for a master-data table, bound to the browser Supabase client. */
export function useCrud<K extends CrudTable>(table: K, orderBy: string): CrudService<K> {
  return useMemo(() => createCrudService(getSupabase(), table, orderBy), [table, orderBy])
}
