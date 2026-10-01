import type { PostgrestError } from '@supabase/supabase-js'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError } from './crud.service'

export interface Option {
  value: string
  label: string
}

interface Row {
  id: string
  [key: string]: unknown
}

async function options(
  query: PromiseLike<{ data: Row[] | null; error: PostgrestError | null }>,
  label: (row: Row) => string,
): Promise<Option[]> {
  const { data, error } = await query
  if (error) throw new DbError(error)
  return (data ?? []).map((row) => ({ value: row.id, label: label(row) }))
}

/** Read-only option lists for select fields (all subject to RLS). */
export function createLookupService(client: AppSupabaseClient) {
  return {
    profiles: () =>
      options(
        client.from('profiles').select('id, full_name, is_active').order('full_name'),
        (r) => `${String(r.full_name)}${r.is_active === false ? ' (đã nghỉ)' : ''}`,
      ),
    roles: () =>
      options(client.from('roles').select('id, name').order('name'), (r) => String(r.name)),
    products: () =>
      options(
        client.from('products').select('id, sku, name').order('sku'),
        (r) => `${String(r.sku)} — ${String(r.name)}`,
      ),
    locations: () =>
      options(
        client.from('locations').select('id, code, name').order('code'),
        (r) => `${String(r.code)} — ${String(r.name)}`,
      ),
  }
}

export type LookupService = ReturnType<typeof createLookupService>
