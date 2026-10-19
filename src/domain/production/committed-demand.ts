/**
 * PRD-001: future committed demand by SKU and needed date (PRD_UIUX §15, TECH_DESIGN §6.4).
 *
 * `public.future_committed_demand()` computes this in the database; this module is the reference of the same
 * rules in pure TypeScript (unit-tested) plus the helpers the production screens and PRD-002 consume.
 *
 * Invariant: the quantity is exactly the one `public.committed_demand()` reports (CONFIRMED orders,
 * quantity - allocated_quantity per line). Only the split over dates is added, so for every product
 * `sum(rows) === committed_demand().committed_qty`. Physical allocation is never counted as demand and a
 * multi-delivery line is split over its delivery dates once.
 */

/** How the needed date of a row was obtained. */
export const DEMAND_DATE_BASIS = {
  /** A delivery scheduled_date determines the date. */
  DELIVERY_DATE: 'DELIVERY_DATE',
  /** Part of the quantity is not on any delivery: no date exists. */
  UNSCHEDULED: 'UNSCHEDULED',
  /**
   * A partly allocated line whose uncovered units could belong to more than one date (or to the unscheduled
   * part). Which units are allocated is allocation policy, not an approved demand rule: not guessed.
   */
  DATE_UNDETERMINED: 'DATE_UNDETERMINED',
} as const

export type DemandDateBasis = (typeof DEMAND_DATE_BASIS)[keyof typeof DEMAND_DATE_BASIS]

/** Only CONFIRMED orders are committed demand; RESERVED already holds physical stock (RES-004). */
export const COMMITTED_ORDER_STATUS = 'CONFIRMED'

/** The only delivery status that no longer carries quantity (same set the delivery guard counts). */
export const NON_COUNTING_DELIVERY_STATUS = 'CANCELLED'

export interface DemandDelivery {
  /** Calendar date `YYYY-MM-DD`. */
  scheduledDate: string
  status: string
  quantity: number
}

export interface DemandLine {
  orderId: string
  orderStatus: string
  productId: string
  quantity: number
  allocatedQuantity: number
  deliveries: DemandDelivery[]
}

/** One row of `future_committed_demand()`. */
export interface FutureDemandRow {
  productId: string
  /** `null` unless `dateBasis` is DELIVERY_DATE. */
  neededDate: string | null
  dateBasis: DemandDateBasis
  orderCount: number
  committedQty: number
  /** Range of the dates the quantity may belong to (DATE_UNDETERMINED only). */
  earliestCandidateDate: string | null
  latestCandidateDate: string | null
}

interface Bucket {
  productId: string
  orderId: string
  neededDate: string | null
  basis: DemandDateBasis
  qty: number
  first: string | null
  last: string | null
}

/** The part of one line that is future committed demand, as dated / unscheduled / undetermined buckets. */
function splitLine(line: DemandLine): Bucket[] {
  if (line.orderStatus !== COMMITTED_ORDER_STATUS) return []
  const remaining = line.quantity - line.allocatedQuantity
  if (remaining <= 0) return []

  const byDate = new Map<string, number>()
  for (const d of line.deliveries) {
    if (d.status === NON_COUNTING_DELIVERY_STATUS || d.quantity <= 0) continue
    byDate.set(d.scheduledDate, (byDate.get(d.scheduledDate) ?? 0) + d.quantity)
  }
  const dates = [...byDate.keys()].sort()
  const scheduled = [...byDate.values()].reduce((a, b) => a + b, 0)
  const base = { productId: line.productId, orderId: line.orderId }
  const out: Bucket[] = []

  if (line.allocatedQuantity === 0) {
    // Nothing is physically held: each delivery quantity is uncovered at its own date.
    for (const date of dates) {
      out.push({
        ...base,
        neededDate: date,
        basis: 'DELIVERY_DATE',
        qty: byDate.get(date) ?? 0,
        first: null,
        last: null,
      })
    }
    if (line.quantity > scheduled) {
      out.push({
        ...base,
        neededDate: null,
        basis: 'UNSCHEDULED',
        qty: line.quantity - scheduled,
        first: null,
        last: null,
      })
    }
    return out
  }

  if (dates.length === 0) {
    out.push({
      ...base,
      neededDate: null,
      basis: 'UNSCHEDULED',
      qty: remaining,
      first: null,
      last: null,
    })
  } else if (dates.length === 1 && scheduled === line.quantity) {
    // Fully scheduled on one date: whatever is still uncovered is needed on that date.
    out.push({
      ...base,
      neededDate: dates[0] ?? null,
      basis: 'DELIVERY_DATE',
      qty: remaining,
      first: null,
      last: null,
    })
  } else {
    out.push({
      ...base,
      neededDate: null,
      basis: 'DATE_UNDETERMINED',
      qty: remaining,
      first: dates[0] ?? null,
      last: dates[dates.length - 1] ?? null,
    })
  }
  return out
}

/** Reference implementation of `future_committed_demand()`, ordered like the RPC (product, date, basis). */
export function aggregateFutureDemand(lines: DemandLine[]): FutureDemandRow[] {
  const groups = new Map<
    string,
    { row: FutureDemandRow; orders: Set<string>; first: string | null; last: string | null }
  >()
  for (const line of lines) {
    for (const b of splitLine(line)) {
      if (b.qty <= 0) continue
      const key = `${b.productId}|${b.neededDate ?? ''}|${b.basis}`
      let g = groups.get(key)
      if (!g) {
        g = {
          row: {
            productId: b.productId,
            neededDate: b.neededDate,
            dateBasis: b.basis,
            orderCount: 0,
            committedQty: 0,
            earliestCandidateDate: null,
            latestCandidateDate: null,
          },
          orders: new Set(),
          first: null,
          last: null,
        }
        groups.set(key, g)
      }
      g.row.committedQty += b.qty
      g.orders.add(b.orderId)
      if (b.first && (g.first === null || b.first < g.first)) g.first = b.first
      if (b.last && (g.last === null || b.last > g.last)) g.last = b.last
    }
  }
  return [...groups.values()]
    .map(({ row, orders, first, last }) => ({
      ...row,
      orderCount: orders.size,
      earliestCandidateDate: first,
      latestCandidateDate: last,
    }))
    .sort(
      (a, b) =>
        a.productId.localeCompare(b.productId) ||
        (a.neededDate === null ? 1 : 0) - (b.neededDate === null ? 1 : 0) ||
        (a.neededDate ?? '').localeCompare(b.neededDate ?? '') ||
        a.dateBasis.localeCompare(b.dateBasis),
    )
}

/** Per-SKU totals of all rows, i.e. what `committed_demand()` reports (the reconciliation invariant). */
export function totalByProduct(rows: FutureDemandRow[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.productId, (totals.get(r.productId) ?? 0) + r.committedQty)
  return totals
}

/** Quantity whose date is known / unknown for one SKU: what the production plan can place on a day. */
export interface ProductDemandSummary {
  productId: string
  total: number
  dated: number
  unscheduled: number
  undetermined: number
}

export function summarizeByProduct(rows: FutureDemandRow[]): ProductDemandSummary[] {
  const out = new Map<string, ProductDemandSummary>()
  for (const r of rows) {
    const s = out.get(r.productId) ?? {
      productId: r.productId,
      total: 0,
      dated: 0,
      unscheduled: 0,
      undetermined: 0,
    }
    s.total += r.committedQty
    if (r.dateBasis === 'DELIVERY_DATE') s.dated += r.committedQty
    else if (r.dateBasis === 'UNSCHEDULED') s.unscheduled += r.committedQty
    else s.undetermined += r.committedQty
    out.set(r.productId, s)
  }
  return [...out.values()].sort((a, b) => a.productId.localeCompare(b.productId))
}
