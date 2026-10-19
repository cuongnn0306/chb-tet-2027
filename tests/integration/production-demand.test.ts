/* eslint-disable @typescript-eslint/no-explicit-any -- RPC results are dynamic JSON; the tests assert on their shape */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database.generated'
import { TEST_PASSWORD, TEST_USERS, getLocalConfig, serviceClient } from './helpers'

/**
 * PRD-001: public.future_committed_demand() splits the SAME quantity as public.committed_demand()
 * (CONFIRMED orders, quantity - allocated) over delivery dates. Each test uses its own product, so the
 * assertions are exact and independent of other data in the shared local database.
 */

async function clientFor(email: string): Promise<AppSupabaseClient> {
  const { url, anonKey } = getLocalConfig()
  const client = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error) throw error
  return client
}

const rpc = (client: AppSupabaseClient, fn: string, args: Record<string, unknown> = {}) =>
  (
    client as unknown as {
      rpc: (f: string, a: unknown) => PromiseLike<{ data: any; error: any }>
    }
  ).rpc(fn, args)

let admin: AppSupabaseClient
let sale: AppSupabaseClient
let store: AppSupabaseClient
let warehouse: AppSupabaseClient
let production: AppSupabaseClient
let anon: AppSupabaseClient
let customer: string
const svc = () => serviceClient()

beforeAll(async () => {
  ;[admin, sale, store, warehouse, production] = await Promise.all([
    clientFor(TEST_USERS.admin),
    clientFor(TEST_USERS.sale),
    clientFor(TEST_USERS.store),
    clientFor(TEST_USERS.warehouse),
    clientFor(TEST_USERS.production),
  ])
  const { url, anonKey } = getLocalConfig()
  anon = createClient<Database>(url, anonKey, { auth: { persistSession: false } })
  const { data } = await svc()
    .from('customers')
    .select('id')
    .eq('phone_normalized', '0900000003')
    .single()
  customer = data?.id as string
})

const act = (client: AppSupabaseClient, id: string, action: string) =>
  rpc(client, 'transition_order', { p_order_id: id, p_action: action, p_reason: null })

interface World {
  productId: string
  x: string
}

/** One product with `qty` units (one batch) at one location; qty 0 means no stock at all. */
async function world(qty: number): Promise<World> {
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data: product } = await svc()
    .from('products')
    .insert({
      sku: `P-FD-${tag}`,
      name: `Bánh nhu cầu ${tag}`,
      list_price: 100000,
      default_commission_rate: 0,
    })
    .select('id')
    .single()
  const { data: loc } = await svc()
    .from('locations')
    .insert({ code: `FD-${tag}`, name: `Kho FD ${tag}`, location_type: 'STORE', region: 'HN' })
    .select('id')
    .single()
  if (qty > 0) {
    const { data: batch } = await admin
      .from('product_batches')
      .insert({
        batch_code: `B-${randomUUID().slice(0, 6)}`,
        product_id: product?.id as string,
        manufactured_date: '2026-09-01',
        expiry_date: '2027-06-01',
      })
      .select('id')
      .single()
    const res = await rpc(admin, 'record_opening_stock', {
      p_location_id: loc?.id,
      p_product_id: product?.id,
      p_batch_id: batch?.id,
      p_quantity: qty,
    })
    expect(res.error).toBeNull()
  }
  return { productId: product?.id as string, x: loc?.id as string }
}

async function draftOrder(w: World, qty: number) {
  const { data, error } = await rpc(sale, 'save_draft_order', {
    p_order_id: null,
    p_customer_id: customer,
    p_items: [{ product_id: w.productId, quantity: qty }],
    p_discount_amount: 0,
    p_creation_location_id: w.x,
  })
  expect(error).toBeNull()
  const { data: items } = await svc().from('order_items').select('id').eq('order_id', data.id)
  return { id: data.id as string, itemId: items?.[0]?.id as string }
}

async function confirmedOrder(w: World, qty: number) {
  const order = await draftOrder(w, qty)
  expect((await act(sale, order.id, 'submit')).error).toBeNull()
  expect((await act(admin, order.id, 'confirm')).error).toBeNull()
  // Deposit rules are covered by the payment tests: stand in with the allowed jump to CONFIRMED.
  await svc().from('orders').update({ status: 'CONFIRMED' }).eq('id', order.id)
  return order
}

type Order = Awaited<ReturnType<typeof draftOrder>>

const planOn = (order: Order, qty: number, source: string, date: string) =>
  rpc(sale, 'save_delivery', {
    p_delivery_id: null,
    p_order_id: order.id,
    p_scheduled_date: date,
    p_items: [{ order_item_id: order.itemId, quantity: qty }],
    p_delivery_address: '12 Phố Huế, Hà Nội',
    p_source_location_id: source,
  })

const DAY1 = '2027-02-03'
const DAY2 = '2027-02-05'

/** Rows of the new read model for one product, with numbers instead of bigint strings. */
async function demandRows(client: AppSupabaseClient, productId: string) {
  const { data, error } = await rpc(client, 'future_committed_demand')
  expect(error).toBeNull()
  return (data as any[])
    .filter((r) => r.product_id === productId)
    .map((r) => ({ ...r, committed_qty: Number(r.committed_qty) }))
}

async function existingTotal(productId: string) {
  const { data } = await rpc(admin, 'committed_demand')
  const row = (data as any[]).find((r) => r.product_id === productId)
  return row ? Number(row.committed_qty) : 0
}

const sum = (rows: { committed_qty: number }[]) => rows.reduce((a, r) => a + r.committed_qty, 0)

describe('future_committed_demand permissions', () => {
  it('lets Admin, Warehouse and Production read it and denies Sale, Store and anonymous', async () => {
    for (const client of [admin, warehouse, production]) {
      expect((await rpc(client, 'future_committed_demand')).error).toBeNull()
    }
    for (const client of [sale, store]) {
      expect((await rpc(client, 'future_committed_demand')).error?.code).toBe('42501')
    }
    expect((await rpc(anon, 'future_committed_demand')).error).not.toBeNull()
  })

  it('keeps committed_demand() unchanged: same roles, same signature', async () => {
    expect((await rpc(production, 'committed_demand')).error).toBeNull()
    expect((await rpc(sale, 'committed_demand')).error?.code).toBe('42501')
  })
})

describe('future_committed_demand calculation', () => {
  it('splits a multi-delivery line over its dates once and reconciles with committed_demand()', async () => {
    const w = await world(0)
    const order = await confirmedOrder(w, 10)
    expect((await planOn(order, 4, w.x, DAY1)).error).toBeNull()
    expect((await planOn(order, 6, w.x, DAY2)).error).toBeNull()

    const rows = await demandRows(production, w.productId)
    expect(rows.map((r) => [r.needed_date, r.date_basis, r.committed_qty, r.order_count])).toEqual([
      [DAY1, 'DELIVERY_DATE', 4, 1],
      [DAY2, 'DELIVERY_DATE', 6, 1],
    ])
    expect(sum(rows)).toBe(await existingTotal(w.productId))
  })

  it('adds the orders of one SKU and date and counts them', async () => {
    const w = await world(0)
    const a = await confirmedOrder(w, 5)
    const b = await confirmedOrder(w, 7)
    expect((await planOn(a, 5, w.x, DAY1)).error).toBeNull()
    expect((await planOn(b, 7, w.x, DAY1)).error).toBeNull()

    const rows = await demandRows(admin, w.productId)
    expect(rows.map((r) => [r.needed_date, r.committed_qty, r.order_count])).toEqual([
      [DAY1, 12, 2],
    ])
  })

  it('reports an order without a delivery as UNSCHEDULED with no date', async () => {
    const w = await world(0)
    await confirmedOrder(w, 8)
    const rows = await demandRows(warehouse, w.productId)
    expect(rows).toEqual([
      expect.objectContaining({
        needed_date: null,
        date_basis: 'UNSCHEDULED',
        committed_qty: 8,
        order_count: 1,
      }),
    ])
    expect(sum(rows)).toBe(await existingTotal(w.productId))
  })

  it('reports the quantity not yet on a delivery as UNSCHEDULED next to the dated part', async () => {
    const w = await world(0)
    const order = await confirmedOrder(w, 10)
    expect((await planOn(order, 6, w.x, DAY1)).error).toBeNull()
    const rows = await demandRows(admin, w.productId)
    expect(rows.map((r) => [r.needed_date, r.date_basis, r.committed_qty])).toEqual([
      [DAY1, 'DELIVERY_DATE', 6],
      [null, 'UNSCHEDULED', 4],
    ])
    expect(sum(rows)).toBe(10)
  })
})

describe('future_committed_demand status filtering', () => {
  it('ignores orders that are not CONFIRMED', async () => {
    const w = await world(0)
    await draftOrder(w, 5) // DRAFT
    const waiting = await draftOrder(w, 6)
    expect((await act(sale, waiting.id, 'submit')).error).toBeNull() // WAITING_CONFIRMATION
    const cancelled = await confirmedOrder(w, 7)
    await svc()
      .from('orders')
      .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() })
      .eq('id', cancelled.id)

    expect(await demandRows(admin, w.productId)).toEqual([])
    expect(await existingTotal(w.productId)).toBe(0)
  })

  it('gives a cancelled delivery quantity back to the unscheduled part', async () => {
    const w = await world(0)
    const order = await confirmedOrder(w, 10)
    const first = (await planOn(order, 4, w.x, DAY1)).data
    expect((await planOn(order, 6, w.x, DAY2)).error).toBeNull()
    const res = await rpc(sale, 'transition_delivery', {
      p_delivery_id: first.id,
      p_action: 'cancel',
      p_reason: 'Khách đổi lịch',
    })
    expect(res.error).toBeNull()

    const rows = await demandRows(admin, w.productId)
    expect(rows.map((r) => [r.needed_date, r.date_basis, r.committed_qty])).toEqual([
      [DAY2, 'DELIVERY_DATE', 6],
      [null, 'UNSCHEDULED', 4],
    ])
  })
})

describe('future_committed_demand and physical allocation', () => {
  it('does not count allocated units and does not guess the date of a partly covered multi-delivery line', async () => {
    const w = await world(4)
    const order = await confirmedOrder(w, 10)
    const early = (await planOn(order, 4, w.x, DAY1)).data
    expect((await planOn(order, 6, w.x, DAY2)).error).toBeNull()
    const alloc = await rpc(admin, 'allocate_delivery_stock', {
      p_delivery_id: early.id,
      p_allow_below_safety: true,
    })
    expect(alloc.error).toBeNull()

    const rows = await demandRows(admin, w.productId)
    expect(rows).toEqual([
      expect.objectContaining({
        needed_date: null,
        date_basis: 'DATE_UNDETERMINED',
        committed_qty: 6,
        earliest_candidate_date: DAY1,
        latest_candidate_date: DAY2,
      }),
    ])
    // The invariant of RES-004 holds: 10 ordered - 4 physically allocated.
    expect(sum(rows)).toBe(await existingTotal(w.productId))
    expect(await existingTotal(w.productId)).toBe(6)
  })

  it('drops a fully allocated order (RESERVED) from the demand', async () => {
    const w = await world(10)
    const order = await confirmedOrder(w, 10)
    expect((await planOn(order, 10, w.x, DAY1)).error).toBeNull()
    const res = await rpc(admin, 'allocate_order', { p_order_id: order.id })
    expect(res.error).toBeNull()
    expect(await demandRows(admin, w.productId)).toEqual([])
    expect(await existingTotal(w.productId)).toBe(0)
  })
})
