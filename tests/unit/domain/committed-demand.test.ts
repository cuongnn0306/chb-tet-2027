import { describe, expect, it } from 'vitest'
import {
  aggregateFutureDemand,
  summarizeByProduct,
  totalByProduct,
  type DemandLine,
} from '@/domain/production/committed-demand'
import { mapFutureDemandRow } from '@/services/production-demand.service'

const P1 = 'product-1'
const P2 = 'product-2'

function line(over: Partial<DemandLine> & Pick<DemandLine, 'orderId' | 'productId'>): DemandLine {
  return {
    orderStatus: 'CONFIRMED',
    quantity: 10,
    allocatedQuantity: 0,
    deliveries: [],
    ...over,
  }
}

const delivery = (scheduledDate: string, quantity: number, status = 'PREPARING') => ({
  scheduledDate,
  quantity,
  status,
})

/** What public.committed_demand() computes: CONFIRMED, quantity - allocated, per product. */
function committedDemandReference(lines: DemandLine[]) {
  const totals = new Map<string, number>()
  for (const l of lines) {
    if (l.orderStatus !== 'CONFIRMED' || l.quantity <= l.allocatedQuantity) continue
    totals.set(l.productId, (totals.get(l.productId) ?? 0) + l.quantity - l.allocatedQuantity)
  }
  return totals
}

describe('aggregateFutureDemand: calculation', () => {
  it('puts a single scheduled delivery on its date', () => {
    const rows = aggregateFutureDemand([
      line({
        orderId: 'o1',
        productId: P1,
        quantity: 10,
        deliveries: [delivery('2027-02-03', 10)],
      }),
    ])
    expect(rows).toEqual([
      {
        productId: P1,
        neededDate: '2027-02-03',
        dateBasis: 'DELIVERY_DATE',
        orderCount: 1,
        committedQty: 10,
        earliestCandidateDate: null,
        latestCandidateDate: null,
      },
    ])
  })

  it('adds the lines of several orders for the same SKU and date and counts the orders', () => {
    const rows = aggregateFutureDemand([
      line({
        orderId: 'o1',
        productId: P1,
        quantity: 10,
        deliveries: [delivery('2027-02-03', 10)],
      }),
      line({ orderId: 'o2', productId: P1, quantity: 5, deliveries: [delivery('2027-02-03', 5)] }),
      line({ orderId: 'o3', productId: P1, quantity: 4, deliveries: [delivery('2027-02-04', 4)] }),
      line({ orderId: 'o4', productId: P2, quantity: 7, deliveries: [delivery('2027-02-03', 7)] }),
    ])
    expect(rows.map((r) => [r.productId, r.neededDate, r.committedQty, r.orderCount])).toEqual([
      [P1, '2027-02-03', 15, 2],
      [P1, '2027-02-04', 4, 1],
      [P2, '2027-02-03', 7, 1],
    ])
  })

  it('reports an order with no delivery as UNSCHEDULED, never dropped and never given a date', () => {
    const rows = aggregateFutureDemand([line({ orderId: 'o1', productId: P1, quantity: 8 })])
    expect(rows).toEqual([
      expect.objectContaining({
        productId: P1,
        neededDate: null,
        dateBasis: 'UNSCHEDULED',
        committedQty: 8,
      }),
    ])
  })

  it('reports the quantity not yet assigned to a delivery as UNSCHEDULED next to the dated part', () => {
    const rows = aggregateFutureDemand([
      line({ orderId: 'o1', productId: P1, quantity: 10, deliveries: [delivery('2027-02-03', 6)] }),
    ])
    expect(rows.map((r) => [r.neededDate, r.dateBasis, r.committedQty])).toEqual([
      ['2027-02-03', 'DELIVERY_DATE', 6],
      [null, 'UNSCHEDULED', 4],
    ])
  })

  it('orders dated rows by date and puts rows without a date last', () => {
    const rows = aggregateFutureDemand([
      line({ orderId: 'o1', productId: P1, quantity: 3 }),
      line({ orderId: 'o2', productId: P1, quantity: 2, deliveries: [delivery('2027-02-05', 2)] }),
      line({ orderId: 'o3', productId: P1, quantity: 1, deliveries: [delivery('2027-02-01', 1)] }),
    ])
    expect(rows.map((r) => r.neededDate)).toEqual(['2027-02-01', '2027-02-05', null])
  })
})

describe('aggregateFutureDemand: status filtering', () => {
  const statuses = [
    'DRAFT',
    'WAITING_CONFIRMATION',
    'WAITING_DEPOSIT',
    'RESERVED',
    'PREPARING',
    'WAITING_DELIVERY',
    'COMPLETED',
    'CANCELLED',
    'VOIDED',
    'RETURNED',
    'EXCHANGED',
  ]

  it.each(statuses)('does not count an order in %s', (orderStatus) => {
    expect(
      aggregateFutureDemand([
        line({
          orderId: 'o1',
          productId: P1,
          orderStatus,
          deliveries: [delivery('2027-02-03', 10)],
        }),
      ]),
    ).toEqual([])
  })

  it('counts only CONFIRMED orders when mixed with others', () => {
    const rows = aggregateFutureDemand([
      line({ orderId: 'o1', productId: P1, quantity: 4, deliveries: [delivery('2027-02-03', 4)] }),
      line({ orderId: 'o2', productId: P1, quantity: 9, orderStatus: 'CANCELLED' }),
      line({ orderId: 'o3', productId: P1, quantity: 9, orderStatus: 'RESERVED' }),
    ])
    expect(rows.map((r) => r.committedQty)).toEqual([4])
  })

  it('ignores CANCELLED deliveries: their quantity is back in the unscheduled part', () => {
    const rows = aggregateFutureDemand([
      line({
        orderId: 'o1',
        productId: P1,
        quantity: 10,
        deliveries: [delivery('2027-02-03', 10, 'CANCELLED'), delivery('2027-02-06', 4)],
      }),
    ])
    expect(rows.map((r) => [r.neededDate, r.dateBasis, r.committedQty])).toEqual([
      ['2027-02-06', 'DELIVERY_DATE', 4],
      [null, 'UNSCHEDULED', 6],
    ])
  })

  it('skips a fully allocated line', () => {
    expect(
      aggregateFutureDemand([
        line({
          orderId: 'o1',
          productId: P1,
          quantity: 10,
          allocatedQuantity: 10,
          deliveries: [delivery('2027-02-03', 10)],
        }),
      ]),
    ).toEqual([])
  })
})

describe('aggregateFutureDemand: multi-delivery and physical allocation', () => {
  it('splits a multi-delivery line over its dates once (no double counting)', () => {
    const rows = aggregateFutureDemand([
      line({
        orderId: 'o1',
        productId: P1,
        quantity: 10,
        deliveries: [delivery('2027-02-03', 4), delivery('2027-02-05', 6)],
      }),
    ])
    expect(rows.map((r) => [r.neededDate, r.committedQty, r.orderCount])).toEqual([
      ['2027-02-03', 4, 1],
      ['2027-02-05', 6, 1],
    ])
    expect(totalByProduct(rows).get(P1)).toBe(10)
  })

  it('merges two deliveries of one line on the same date into one row', () => {
    const rows = aggregateFutureDemand([
      line({
        orderId: 'o1',
        productId: P1,
        quantity: 10,
        deliveries: [delivery('2027-02-03', 4), delivery('2027-02-03', 6, 'READY')],
      }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ neededDate: '2027-02-03', committedQty: 10, orderCount: 1 })
  })

  it('does not count physically allocated quantity: remainder of a single-date line stays on that date', () => {
    const rows = aggregateFutureDemand([
      line({
        orderId: 'o1',
        productId: P1,
        quantity: 10,
        allocatedQuantity: 4,
        deliveries: [delivery('2027-02-03', 10)],
      }),
    ])
    expect(rows.map((r) => [r.neededDate, r.dateBasis, r.committedQty])).toEqual([
      ['2027-02-03', 'DELIVERY_DATE', 6],
    ])
  })

  it('does not guess which delivery the allocated units cover: DATE_UNDETERMINED with candidate range', () => {
    const rows = aggregateFutureDemand([
      line({
        orderId: 'o1',
        productId: P1,
        quantity: 10,
        allocatedQuantity: 3,
        deliveries: [delivery('2027-02-05', 6), delivery('2027-02-03', 4)],
      }),
    ])
    expect(rows).toEqual([
      expect.objectContaining({
        neededDate: null,
        dateBasis: 'DATE_UNDETERMINED',
        committedQty: 7,
        earliestCandidateDate: '2027-02-03',
        latestCandidateDate: '2027-02-05',
      }),
    ])
  })

  it('treats a partly allocated line with an unscheduled part as DATE_UNDETERMINED', () => {
    const rows = aggregateFutureDemand([
      line({
        orderId: 'o1',
        productId: P1,
        quantity: 10,
        allocatedQuantity: 2,
        deliveries: [delivery('2027-02-03', 6)],
      }),
    ])
    expect(rows).toEqual([
      expect.objectContaining({ dateBasis: 'DATE_UNDETERMINED', committedQty: 8 }),
    ])
  })

  it('treats a partly allocated line with no delivery as UNSCHEDULED', () => {
    const rows = aggregateFutureDemand([
      line({ orderId: 'o1', productId: P1, quantity: 10, allocatedQuantity: 2 }),
    ])
    expect(rows).toEqual([
      expect.objectContaining({ dateBasis: 'UNSCHEDULED', neededDate: null, committedQty: 8 }),
    ])
  })

  it('counts an order once per row even when its lines share a product bucket', () => {
    const rows = aggregateFutureDemand([
      line({ orderId: 'o1', productId: P1, quantity: 5, deliveries: [delivery('2027-02-03', 5)] }),
      line({ orderId: 'o1', productId: P1, quantity: 5, deliveries: [delivery('2027-02-03', 5)] }),
    ])
    expect(rows[0]).toMatchObject({ committedQty: 10, orderCount: 1 })
  })
})

describe('reconciliation with committed_demand()', () => {
  const mixed: DemandLine[] = [
    line({ orderId: 'a', productId: P1, quantity: 10, deliveries: [delivery('2027-02-03', 10)] }),
    line({
      orderId: 'b',
      productId: P1,
      quantity: 12,
      deliveries: [delivery('2027-02-03', 5), delivery('2027-02-07', 7)],
    }),
    line({ orderId: 'c', productId: P1, quantity: 9, allocatedQuantity: 4 }),
    line({
      orderId: 'd',
      productId: P2,
      quantity: 8,
      allocatedQuantity: 3,
      deliveries: [delivery('2027-02-03', 2), delivery('2027-02-04', 6)],
    }),
    line({
      orderId: 'e',
      productId: P2,
      quantity: 6,
      deliveries: [delivery('2027-02-05', 3, 'CANCELLED')],
    }),
    line({
      orderId: 'f',
      productId: P2,
      quantity: 6,
      orderStatus: 'RESERVED',
      allocatedQuantity: 6,
    }),
    line({ orderId: 'g', productId: P2, quantity: 5, orderStatus: 'CANCELLED' }),
    line({ orderId: 'h', productId: P1, quantity: 3, allocatedQuantity: 3 }),
  ]

  it('every SKU total equals the existing confirmed/unallocated demand', () => {
    expect(totalByProduct(aggregateFutureDemand(mixed))).toEqual(committedDemandReference(mixed))
  })

  it('summarizes known, unscheduled and undetermined quantity per SKU without losing any', () => {
    const summary = summarizeByProduct(aggregateFutureDemand(mixed))
    expect(summary).toEqual([
      { productId: P1, total: 27, dated: 22, unscheduled: 5, undetermined: 0 },
      { productId: P2, total: 11, dated: 0, unscheduled: 6, undetermined: 5 },
    ])
    for (const s of summary) expect(s.total).toBe(s.dated + s.unscheduled + s.undetermined)
  })
})

describe('mapFutureDemandRow', () => {
  it('converts bigint strings and snake_case columns', () => {
    expect(
      mapFutureDemandRow({
        product_id: P1,
        needed_date: '2027-02-03',
        date_basis: 'DELIVERY_DATE',
        order_count: 2,
        committed_qty: '15',
        earliest_candidate_date: null,
        latest_candidate_date: null,
      }),
    ).toEqual({
      productId: P1,
      neededDate: '2027-02-03',
      dateBasis: 'DELIVERY_DATE',
      orderCount: 2,
      committedQty: 15,
      earliestCandidateDate: null,
      latestCandidateDate: null,
    })
  })
})
