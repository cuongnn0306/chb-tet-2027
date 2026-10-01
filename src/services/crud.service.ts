import type { PostgrestError } from '@supabase/supabase-js'
import type { AppSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database.generated'

/** Master-data tables with plain admin CRUD (RLS decides who may write; nothing is hard-deleted). */
/** Extend this union as each master-data table is added (products, commission_rules, ...). */
export type CrudTable = 'locations' | 'sales_channels' | 'lead_sources'

export type RowOf<K extends CrudTable> = Database['public']['Tables'][K]['Row']
export type InsertOf<K extends CrudTable> = Database['public']['Tables'][K]['Insert']
export type UpdateOf<K extends CrudTable> = Database['public']['Tables'][K]['Update']

export class DbError extends Error {
  readonly code: string | undefined
  constructor(error: PostgrestError) {
    super(error.message)
    this.name = 'DbError'
    this.code = error.code
  }
}

interface Result<T> {
  data: T | null
  error: PostgrestError | null
}

/** Minimal structural view of the query builder; keeps generics out of the deep supabase-js types. */
interface UntypedTable {
  select(columns: string): { order(column: string): PromiseLike<Result<unknown[]>> }
  insert(values: object): { select(): { single(): PromiseLike<Result<unknown>> } }
  update(values: object): {
    eq(column: string, value: string): { select(): { single(): PromiseLike<Result<unknown>> } }
  }
}

export interface CrudService<K extends CrudTable> {
  list(): Promise<RowOf<K>[]>
  create(input: InsertOf<K>): Promise<RowOf<K>>
  update(id: string, input: UpdateOf<K>): Promise<RowOf<K>>
}

/**
 * List/create/update for a master-data table. There is deliberately no delete:
 * records are deactivated (is_active) so history stays traceable.
 */
export function createCrudService<K extends CrudTable>(
  client: AppSupabaseClient,
  table: K,
  orderBy: string,
): CrudService<K> {
  const api = () => (client as unknown as { from(t: string): UntypedTable }).from(table)

  function unwrap<T>(result: Result<unknown>): T {
    if (result.error) throw new DbError(result.error)
    return result.data as T
  }

  return {
    async list() {
      return unwrap<RowOf<K>[]>(await api().select('*').order(orderBy))
    },
    async create(input) {
      return unwrap<RowOf<K>>(await api().insert(input).select().single())
    },
    async update(id, input) {
      return unwrap<RowOf<K>>(await api().update(input).eq('id', id).select().single())
    },
  }
}
