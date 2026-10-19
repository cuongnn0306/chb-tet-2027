import {
  summarizeByProduct,
  type DemandDateBasis,
  type FutureDemandRow,
  type ProductDemandSummary,
} from '@/domain/production/committed-demand'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError } from './crud.service'

/** What `future_committed_demand()` returns (bigint columns can arrive as strings). */
interface FutureDemandDbRow {
  product_id: string
  needed_date: string | null
  date_basis: DemandDateBasis
  order_count: number
  committed_qty: number | string
  earliest_candidate_date: string | null
  latest_candidate_date: string | null
}

export function mapFutureDemandRow(row: FutureDemandDbRow): FutureDemandRow {
  return {
    productId: row.product_id,
    neededDate: row.needed_date,
    dateBasis: row.date_basis,
    orderCount: Number(row.order_count),
    committedQty: Number(row.committed_qty),
    earliestCandidateDate: row.earliest_candidate_date,
    latestCandidateDate: row.latest_candidate_date,
  }
}

/**
 * PRD-001: future committed demand by SKU and needed date. Admin, Warehouse and Production only (the RPC
 * enforces it; other roles get a permission error). Read only: it never allocates, reserves or changes a status.
 */
export function createProductionDemandService(client: AppSupabaseClient) {
  const call = async () =>
    await (
      client as unknown as {
        rpc: (f: string) => PromiseLike<{
          data: FutureDemandDbRow[] | null
          error: { code?: string; message: string } | null
        }>
      }
    ).rpc('future_committed_demand')

  return {
    /** Rows by SKU, needed date and date basis (DELIVERY_DATE, UNSCHEDULED, DATE_UNDETERMINED). */
    async futureDemand(): Promise<FutureDemandRow[]> {
      const { data, error } = await call()
      if (error) throw new DbError(error as never)
      return (data ?? []).map(mapFutureDemandRow)
    },

    /** Per SKU: total and how much of it has a known date, no date, or an undetermined date. */
    async futureDemandSummary(): Promise<ProductDemandSummary[]> {
      return summarizeByProduct(await this.futureDemand())
    },
  }
}

export type ProductionDemandService = ReturnType<typeof createProductionDemandService>
