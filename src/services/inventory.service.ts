import type { ManualExitType, MovementType } from '@/domain/inventory/movements'
import type { ImportRow } from '@/domain/inventory/opening-stock-import'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError } from './crud.service'

export interface SummaryRow {
  location_id: string
  product_id: string
  available_qty: number
  reserved_qty: number
  expired_qty: number
  safety_stock_qty: number
  sellable_qty: number
  in_transfer_qty: number
  pending_inspection_qty: number
  damaged_qty: number
  sample_qty: number
  gift_qty: number
}

export interface BalanceRow {
  id: string
  location_id: string
  product_id: string
  batch_id: string
  available_qty: number
  reserved_qty: number
  in_transfer_qty: number
  pending_inspection_qty: number
  damaged_qty: number
  sample_qty: number
  gift_qty: number
  locations: { code: string; name: string } | null
  products: { sku: string; name: string } | null
  product_batches: {
    batch_code: string
    manufactured_date: string
    expiry_date: string
    status: string
  } | null
}

export interface BatchRow {
  id: string
  batch_code: string
  product_id: string
  manufactured_date: string
  expiry_date: string
  status: string
}

export interface MovementRow {
  id: string
  movement_type: MovementType
  quantity: number
  reason: string | null
  created_at: string
  products: { sku: string; name: string } | null
  product_batches: { batch_code: string } | null
  from_location: { code: string; name: string } | null
  to_location: { code: string; name: string } | null
  creator: { full_name: string } | null
}

export interface BalanceMismatch {
  location_id: string
  product_id: string
  batch_id: string
  column_name: string
  cached_qty: number
  ledger_qty: number
}

export const MOVEMENT_PAGE_SIZE = 50

/** Result of the opening-stock import RPC (INV-006). `row` is the 1-based position in the sent rows. */
export type ImportReport =
  | { ok: false; dry_run: boolean; error_count: number; errors: { row: number; message: string }[] }
  | { ok: true; dry_run: true; rows: number; batches_to_create: number; total_quantity: number }
  | { ok: true; dry_run: false; rows: number; batches_created: number; total_quantity: number }

export interface NewBatch {
  productId: string
  batchCode: string
  manufacturedDate: string
  expiryDate: string
}

export function createInventoryService(client: AppSupabaseClient) {
  function check<T>(result: {
    data: T | null
    error: { code?: string; message: string } | null
  }): T {
    if (result.error) throw new DbError(result.error as never)
    return result.data as T
  }

  return {
    /** INV-007: stock per location and SKU, for every active role. */
    async summary(locationId?: string | null): Promise<SummaryRow[]> {
      const result = await client.rpc('inventory_summary', {
        p_location_id: locationId ?? undefined,
      })
      return check(result as never) as SummaryRow[]
    },

    /** INV-008: stock per batch (Admin, Warehouse, Production). */
    async listBalances(
      params: { locationId?: string; productId?: string } = {},
    ): Promise<BalanceRow[]> {
      let query = client
        .from('inventory_balances')
        .select(
          '*, locations(code, name), products(sku, name), product_batches(batch_code, manufactured_date, expiry_date, status)',
        )
        .order('product_id')
      if (params.locationId) query = query.eq('location_id', params.locationId)
      if (params.productId) query = query.eq('product_id', params.productId)
      const rows = check((await query) as never) as BalanceRow[]
      // Earliest expiry first within a product, the order FEFO would use.
      return rows.sort(
        (a, b) =>
          (a.products?.sku ?? '').localeCompare(b.products?.sku ?? '') ||
          (a.product_batches?.expiry_date ?? '').localeCompare(
            b.product_batches?.expiry_date ?? '',
          ) ||
          (a.locations?.code ?? '').localeCompare(b.locations?.code ?? ''),
      )
    },

    async listBatches(): Promise<BatchRow[]> {
      const result = await client
        .from('product_batches')
        .select('id, batch_code, product_id, manufactured_date, expiry_date, status')
        .order('expiry_date')
      return check(result as never) as BatchRow[]
    },

    /** INV-001: Admin and Warehouse. */
    async createBatch(input: NewBatch): Promise<BatchRow> {
      const result = await client
        .from('product_batches')
        .insert({
          product_id: input.productId,
          batch_code: input.batchCode.trim().toUpperCase(),
          manufactured_date: input.manufacturedDate,
          expiry_date: input.expiryDate,
        })
        .select('id, batch_code, product_id, manufactured_date, expiry_date, status')
        .single()
      return check(result as never) as BatchRow
    },

    async setBatchStatus(batchId: string, status: 'ACTIVE' | 'INACTIVE'): Promise<void> {
      const result = await client
        .from('product_batches')
        .update({ status })
        .eq('id', batchId)
        .select()
        .single()
      check(result as never)
    },

    /** INV-005 (Admin). */
    async recordOpeningStock(input: {
      locationId: string
      productId: string
      batchId: string
      quantity: number
      note?: string
    }): Promise<void> {
      check(
        (await client.rpc('record_opening_stock', {
          p_location_id: input.locationId,
          p_product_id: input.productId,
          p_batch_id: input.batchId,
          p_quantity: input.quantity,
          p_note: input.note ?? undefined,
        })) as never,
      )
    },

    /** INV-010 (Admin, reason required). */
    async adjust(input: {
      direction: 'IN' | 'OUT'
      locationId: string
      productId: string
      batchId: string
      quantity: number
      reason: string
    }): Promise<void> {
      check(
        (await client.rpc('adjust_inventory', {
          p_direction: input.direction,
          p_location_id: input.locationId,
          p_product_id: input.productId,
          p_batch_id: input.batchId,
          p_quantity: input.quantity,
          p_reason: input.reason,
        })) as never,
      )
    },

    /** INV-011 (Admin or Warehouse, reason required). */
    async recordExit(input: {
      type: ManualExitType
      locationId: string
      productId: string
      batchId: string
      quantity: number
      reason: string
    }): Promise<void> {
      check(
        (await client.rpc('record_stock_exit', {
          p_type: input.type,
          p_location_id: input.locationId,
          p_product_id: input.productId,
          p_batch_id: input.batchId,
          p_quantity: input.quantity,
          p_reason: input.reason,
        })) as never,
      )
    },

    /** INV-009: ledger history (Admin, Warehouse), newest first. */
    async listMovements(
      params: { productId?: string; type?: MovementType | ''; page?: number } = {},
    ): Promise<MovementRow[]> {
      const page = params.page ?? 0
      let query = client
        .from('inventory_movements')
        .select(
          'id, movement_type, quantity, reason, created_at, products(sku, name), product_batches(batch_code), from_location:locations!inventory_movements_from_location_id_fkey(code, name), to_location:locations!inventory_movements_to_location_id_fkey(code, name), creator:profiles!inventory_movements_created_by_fkey(full_name)',
        )
        .order('created_at', { ascending: false })
        .range(page * MOVEMENT_PAGE_SIZE, page * MOVEMENT_PAGE_SIZE + MOVEMENT_PAGE_SIZE)
      if (params.productId) query = query.eq('product_id', params.productId)
      if (params.type) query = query.eq('movement_type', params.type)
      return check((await query) as never) as unknown as MovementRow[]
    },

    /** INV-006 (Admin). With `dryRun` nothing changes: the server only validates and reports. */
    async importOpeningStock(rows: ImportRow[], dryRun: boolean): Promise<ImportReport> {
      return check(
        (await client.rpc('import_opening_stock', { p_rows: rows, p_dry_run: dryRun })) as never,
      ) as ImportReport
    },

    /** Admin: does the cache equal the ledger? Returns mismatches only (empty = consistent). */
    async verifyBalances(): Promise<BalanceMismatch[]> {
      return check((await client.rpc('verify_inventory_balances')) as never) as BalanceMismatch[]
    },
  }
}

export type InventoryService = ReturnType<typeof createInventoryService>
