import type { PostgrestError } from '@supabase/supabase-js'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError } from './crud.service'

export interface ProductChoice {
  id: string
  sku: string
  name: string
  listPrice: number
}

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
    /** Active products with their list price, for order entry. */
    async activeProducts(): Promise<ProductChoice[]> {
      const { data, error } = await client
        .from('products')
        .select('id, sku, name, list_price')
        .eq('is_active', true)
        .order('sku')
      if (error) throw new DbError(error)
      return (data ?? []).map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        listPrice: p.list_price,
      }))
    },
    /** Active choices for the three attribution selects of an order. */
    async activeAttribution(): Promise<{
      locations: Option[]
      channels: Option[]
      sources: Option[]
    }> {
      const [locations, channels, sources] = await Promise.all([
        client.from('locations').select('id, code, name').eq('is_active', true).order('code'),
        client.from('sales_channels').select('id, name').eq('is_active', true).order('sort_order'),
        client.from('lead_sources').select('id, name').eq('is_active', true).order('sort_order'),
      ])
      for (const result of [locations, channels, sources]) {
        if (result.error) throw new DbError(result.error)
      }
      return {
        locations: (locations.data ?? []).map((r) => ({
          value: r.id,
          label: `${r.code} — ${r.name}`,
        })),
        channels: (channels.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        sources: (sources.data ?? []).map((r) => ({ value: r.id, label: r.name })),
      }
    },
    locations: () =>
      options(
        client.from('locations').select('id, code, name').order('code'),
        (r) => `${String(r.code)} — ${String(r.name)}`,
      ),
  }
}

export type LookupService = ReturnType<typeof createLookupService>
