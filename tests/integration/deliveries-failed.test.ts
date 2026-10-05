/* eslint-disable @typescript-eslint/no-explicit-any -- RPC results are dynamic JSON; the tests assert on their shape */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database.generated'
import { TEST_PASSWORD, TEST_USERS, getLocalConfig, serviceClient } from './helpers'

/**
 * DEL-012 (review RV-03): the goods of a FAILED delivery are still in logistics until the warehouse
 * takes them back (TECH_DESIGN §7), so they must not be counted as available at the source for
 * another delivery, also not after the failed delivery is rescheduled.
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
let customer: string
const svc = () => serviceClient()

beforeAll(async () => {
  ;[admin, sale, store, warehouse] = await Promise.all([
    clientFor(TEST_USERS.admin),
    clientFor(TEST_USERS.sale),
    clientFor(TEST_USERS.store),
    clientFor(TEST_USERS.warehouse),
  ])
  const { data } = await svc()
    .from('customers')
    .select('id')
    .eq('phone_normalized', '0900000003')
    .single()
  customer = data?.id as string
})

const act = (client: AppSupabaseClient, id: string, action: string, reason?: string) =>
  rpc(client, 'transition_order', { p_order_id: id, p_action: action, p_reason: reason ?? null })
const step = (client: AppSupabaseClient, id: string, action: string, reason?: string) =>
  rpc(client, 'transition_delivery', {
    p_delivery_id: id,
    p_action: action,
    p_reason: reason ?? null,
  })

function inDays(days: number) {
  return new Date(Date.now() + (days + 1) * 86400000).toISOString().slice(0, 10)
}

interface World {
  productId: string
  x: string
  y: string
}

/** One product with two source locations: `atX` units at X and `atY` units at Y. */
async function splitWorld(atX = 5, atY = 5): Promise<World> {
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data: product } = await svc()
    .from('products')
    .insert({
      sku: `P-DF-${tag}`,
      name: `Bánh giao thất bại ${tag}`,
      list_price: 100000,
      default_commission_rate: 0,
    })
    .select('id')
    .single()
  const productId = product?.id as string
  const locations: string[] = []
  for (const [code, qty] of [
    ['X', atX],
    ['Y', atY],
  ] as const) {
    const { data: loc } = await svc()
      .from('locations')
      .insert({
        code: `DF${code}-${tag}`,
        name: `Kho ${code} ${tag}`,
        location_type: 'STORE',
        region: 'HN',
      })
      .select('id')
      .single()
    await addStock(productId, loc?.id as string, qty)
    locations.push(loc?.id as string)
  }
  return { productId, x: locations[0] as string, y: locations[1] as string }
}

async function addStock(productId: string, locationId: string, qty: number) {
  const { data: batch } = await admin
    .from('product_batches')
    .insert({
      batch_code: `B-${randomUUID().slice(0, 6)}`,
      product_id: productId,
      manufactured_date: '2026-09-01',
      expiry_date: '2027-06-01',
    })
    .select('id')
    .single()
  const res = await rpc(admin, 'record_opening_stock', {
    p_location_id: locationId,
    p_product_id: productId,
    p_batch_id: batch?.id,
    p_quantity: qty,
  })
  expect(res.error).toBeNull()
}

/** A confirmed order created at X, physically allocated at X first and then at Y (RESERVED). */
async function splitOrder(w: World, qty: number) {
  const { data, error } = await rpc(sale, 'save_draft_order', {
    p_order_id: null,
    p_customer_id: customer,
    p_items: [{ product_id: w.productId, quantity: qty }],
    p_discount_amount: 0,
    p_creation_location_id: w.x,
  })
  expect(error).toBeNull()
  expect((await act(sale, data.id, 'submit')).error).toBeNull()
  expect((await act(admin, data.id, 'confirm')).error).toBeNull()
  // Deposit rules are covered by the payment tests: stand in with the allowed jump to CONFIRMED.
  await svc().from('orders').update({ status: 'CONFIRMED' }).eq('id', data.id)
  expect(
    (await rpc(admin, 'allocate_order', { p_order_id: data.id, p_location_id: w.x })).error,
  ).toBeNull()
  const second = await rpc(admin, 'allocate_order', { p_order_id: data.id, p_location_id: w.y })
  expect(second.error).toBeNull()
  expect(second.data.fully_allocated).toBe(true)
  const { data: items } = await svc().from('order_items').select('id').eq('order_id', data.id)
  return { id: data.id as string, itemId: items?.[0]?.id as string }
}

type Order = Awaited<ReturnType<typeof splitOrder>>

const plan = (order: Order, qty: number, source: string, client = sale) =>
  rpc(client, 'save_delivery', {
    p_delivery_id: null,
    p_order_id: order.id,
    p_scheduled_date: inDays(1),
    p_items: [{ order_item_id: order.itemId, quantity: qty }],
    p_delivery_address: '12 Phố Huế, Hà Nội',
    p_source_location_id: source,
  })

async function goOut(id: string) {
  expect((await step(warehouse, id, 'ready')).error).toBeNull()
  expect((await step(warehouse, id, 'dispatch')).error).toBeNull()
}

async function fail(id: string) {
  expect((await step(warehouse, id, 'fail', 'Khách vắng nhà')).error).toBeNull()
}

const reservedAt = async (itemId: string, location: string) =>
  (
    (
      await svc()
        .from('inventory_reservations')
        .select('quantity')
        .eq('order_item_id', itemId)
        .eq('location_id', location)
        .eq('status', 'ACTIVE')
        .eq('reservation_type', 'PHYSICAL_ALLOCATION')
    ).data ?? []
  ).reduce((sum, r) => sum + r.quantity, 0)

const balanceAt = async (location: string, productId: string) => {
  const { data } = await svc()
    .from('inventory_balances')
    .select('available_qty, reserved_qty')
    .eq('location_id', location)
    .eq('product_id', productId)
  return {
    available: (data ?? []).reduce((s, r) => s + r.available_qty, 0),
    reserved: (data ?? []).reduce((s, r) => s + r.reserved_qty, 0),
  }
}

const itemRow = async (id: string) =>
  (
    await svc()
      .from('order_items')
      .select('delivered_quantity, allocated_quantity')
      .eq('id', id)
      .single()
  ).data

const LOGISTICS = /logistics/

describe('failed delivery keeps its goods in logistics (DEL-012, RV-03)', () => {
  it('blocks a second delivery from X while failed delivery A still holds the 5 units in logistics', async () => {
    const w = await splitWorld()
    const order = await splitOrder(w, 10) // X: 5, Y: 5
    expect(await reservedAt(order.itemId, w.x)).toBe(5)
    expect(await reservedAt(order.itemId, w.y)).toBe(5)

    const a = await plan(order, 5, w.x)
    expect(a.error).toBeNull()
    await goOut(a.data.id)
    await fail(a.data.id)

    // B also from X is a valid plan (the order still needs 5 more) ...
    const b = await plan(order, 5, w.x)
    expect(b.error).toBeNull()
    expect((await step(warehouse, b.data.id, 'ready')).error).toBeNull()
    // ... but the 5 units at X are with A, so B cannot leave the warehouse
    const blocked = await step(warehouse, b.data.id, 'dispatch')
    expect(blocked.error?.message).toMatch(LOGISTICS)

    const { data: bRow } = await svc()
      .from('deliveries')
      .select('status')
      .eq('id', b.data.id)
      .single()
    expect(bRow?.status).toBe('READY')
    // nothing was released, consumed or moved
    expect(await reservedAt(order.itemId, w.x)).toBe(5)
    expect(await itemRow(order.itemId)).toMatchObject({
      delivered_quantity: 0,
      allocated_quantity: 10,
    })
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('keeps the footprint through reschedule and redispatch and consumes the goods exactly once', async () => {
    const w = await splitWorld()
    const order = await splitOrder(w, 10)
    const a = await plan(order, 5, w.x)
    await goOut(a.data.id)
    await fail(a.data.id)
    const b = await plan(order, 5, w.x)
    await step(warehouse, b.data.id, 'ready')

    // FAILED -> reschedule -> READY: the goods are still out, B stays blocked and A cannot be cancelled
    const rescheduled = await rpc(warehouse, 'reschedule_delivery', {
      p_delivery_id: a.data.id,
      p_scheduled_date: inDays(3),
    })
    expect(rescheduled.error).toBeNull()
    expect(rescheduled.data.status).toBe('READY')
    expect((await step(warehouse, b.data.id, 'dispatch')).error?.message).toMatch(LOGISTICS)
    expect((await step(sale, a.data.id, 'cancel', 'Khách đổi ý')).error?.message).toMatch(LOGISTICS)
    expect(await reservedAt(order.itemId, w.x)).toBe(5)

    // redispatch A (its own goods never block it) and deliver: consumed exactly once
    const before = await balanceAt(w.x, w.productId)
    expect((await step(warehouse, a.data.id, 'dispatch')).error).toBeNull()
    expect((await step(warehouse, a.data.id, 'deliver')).error).toBeNull()
    const after = await balanceAt(w.x, w.productId)
    expect(after.available).toBe(before.available - 5)
    expect(after.reserved).toBe(before.reserved - 5)
    expect(await itemRow(order.itemId)).toMatchObject({
      delivered_quantity: 5,
      allocated_quantity: 5,
    })
    const { data: movements } = await svc()
      .from('inventory_movements')
      .select('movement_type, quantity')
      .eq('delivery_id', a.data.id)
    expect(movements?.every((m) => m.movement_type === 'SALE_OUT')).toBe(true)
    expect(movements?.reduce((s, m) => s + m.quantity, 0)).toBe(5)

    // X has nothing left for B: it can never use the same units a second time
    expect((await step(warehouse, b.data.id, 'dispatch')).error?.message).toMatch(
      /Chưa đủ hàng đã phân bổ|logistics/,
    )

    // the real remedy: plan the missing 5 from Y, where they are allocated
    expect((await step(sale, b.data.id, 'cancel', 'Chuyển sang giao từ kho Y')).error).toBeNull()
    const c = await plan(order, 5, w.y)
    expect(c.error).toBeNull()
    await goOut(c.data.id)
    expect((await step(warehouse, c.data.id, 'deliver')).error).toBeNull()
    expect(await itemRow(order.itemId)).toMatchObject({
      delivered_quantity: 10,
      allocated_quantity: 0,
    })
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
    expect((await balanceAt(w.x, w.productId)).available).toBe(0)
    expect((await balanceAt(w.y, w.productId)).available).toBe(0)
  })

  it('does not hold back a delivery from the other source', async () => {
    const w = await splitWorld()
    const order = await splitOrder(w, 10)
    const a = await plan(order, 5, w.x)
    await goOut(a.data.id)
    await fail(a.data.id)
    const c = await plan(order, 5, w.y)
    await goOut(c.data.id)
    expect((await step(warehouse, c.data.id, 'deliver')).error).toBeNull()
    expect(await reservedAt(order.itemId, w.x)).toBe(5) // A's units stay reserved at X
  })

  it('only blocks what is really missing: goods still at the source can leave', async () => {
    const w = await splitWorld(10, 10)
    const order = await splitOrder(w, 20) // X: 10, Y: 10
    const a = await plan(order, 6, w.x)
    await goOut(a.data.id)
    await fail(a.data.id) // 6 in logistics, 4 still at X
    const fits = await plan(order, 4, w.x)
    await goOut(fits.data.id) // exactly the 4 that are still at X
    const over = await plan(order, 2, w.x)
    await step(warehouse, over.data.id, 'ready')
    expect((await step(warehouse, over.data.id, 'dispatch')).error?.message).toMatch(LOGISTICS)
  })

  it('concurrent deliveries competing for the same source goods: only the available quantity leaves', async () => {
    const w = await splitWorld(10, 5)
    const order = await splitOrder(w, 15) // X: 10, Y: 5
    expect(await reservedAt(order.itemId, w.x)).toBe(10)

    const a = await plan(order, 5, w.x)
    const b = await plan(order, 5, w.x)
    const c = await plan(order, 5, w.x)
    for (const d of [a, b, c]) expect(d.error).toBeNull()
    await goOut(a.data.id)
    await fail(a.data.id)
    for (const d of [b, c]) await step(warehouse, d.data.id, 'ready')

    // 10 reserved at X, 5 with A in logistics: only one of B and C can take the remaining 5
    const results = await Promise.all([
      step(warehouse, b.data.id, 'dispatch'),
      step(warehouse, c.data.id, 'dispatch'),
    ])
    expect(results.filter((r) => r.error === null)).toHaveLength(1)
    expect(results.find((r) => r.error)?.error?.message).toMatch(LOGISTICS)
    const { data: states } = await svc()
      .from('deliveries')
      .select('status')
      .in('id', [b.data.id, c.data.id])
    expect(states?.filter((s) => s.status === 'OUT_FOR_DELIVERY')).toHaveLength(1)
    expect(await reservedAt(order.itemId, w.x)).toBe(10)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('two ready deliveries from the same source cannot both take the same units at once', async () => {
    const w = await splitWorld()
    const order = await splitOrder(w, 10)
    const a = await plan(order, 5, w.x)
    const b = await plan(order, 5, w.x)
    for (const d of [a, b]) await step(warehouse, d.data.id, 'ready')
    const results = await Promise.all([
      step(warehouse, a.data.id, 'dispatch'),
      step(warehouse, b.data.id, 'dispatch'),
    ])
    expect(results.filter((r) => r.error === null)).toHaveLength(1)
  })

  it('dispatching and delivering at the same time never uses a unit twice', async () => {
    const w = await splitWorld(10, 5)
    const order = await splitOrder(w, 15)
    const a = await plan(order, 5, w.x)
    const b = await plan(order, 5, w.x)
    await goOut(a.data.id)
    await step(warehouse, b.data.id, 'ready')
    // deliver A while B is being dispatched: 10 reserved at X cover both, in either order
    const results = await Promise.all([
      step(warehouse, a.data.id, 'deliver'),
      step(warehouse, b.data.id, 'dispatch'),
    ])
    expect(results.every((r) => r.error === null)).toBe(true)
    expect((await step(warehouse, b.data.id, 'deliver')).error).toBeNull()
    expect(await itemRow(order.itemId)).toMatchObject({ delivered_quantity: 10 })
    expect((await balanceAt(w.x, w.productId)).available).toBe(0)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('shows the failed delivery as goods in logistics and flags the competing delivery as a stock risk', async () => {
    const w = await splitWorld()
    const order = await splitOrder(w, 10)
    const a = await plan(order, 5, w.x)
    await goOut(a.data.id)
    await fail(a.data.id)
    const b = await plan(order, 5, w.x)
    const rows = (
      await rpc(warehouse, 'delivery_schedule', { p_from: inDays(0), p_to: inDays(10) })
    ).data as any[]
    expect(rows.find((r) => r.delivery_id === a.data.id)).toMatchObject({
      status: 'FAILED',
      goods_in_logistics: true,
    })
    expect(rows.find((r) => r.delivery_id === b.data.id)).toMatchObject({
      goods_in_logistics: false,
      stock_risk: true,
    })
  })

  it('a delivery that never left the warehouse is not in logistics and can still be cancelled', async () => {
    const w = await splitWorld()
    const order = await splitOrder(w, 10)
    const a = await plan(order, 5, w.x)
    await step(warehouse, a.data.id, 'ready')
    const rows = (
      await rpc(warehouse, 'delivery_schedule', { p_from: inDays(0), p_to: inDays(10) })
    ).data as any[]
    expect(rows.find((r) => r.delivery_id === a.data.id)).toMatchObject({
      goods_in_logistics: false,
      stock_risk: false,
    })
    expect((await step(sale, a.data.id, 'cancel', 'Khách đổi ý')).error).toBeNull()
  })

  it('the logistics marker is set only by dispatch and cannot be cleared by hand, even with the service role', async () => {
    const w = await splitWorld()
    const order = await splitOrder(w, 10)
    const a = await plan(order, 5, w.x)
    const read = async () =>
      (await svc().from('deliveries').select('dispatched_at').eq('id', a.data.id).single()).data
        ?.dispatched_at
    expect(await read()).toBeNull()
    const early = await svc()
      .from('deliveries')
      .update({ dispatched_at: new Date().toISOString() })
      .eq('id', a.data.id)
    expect(early.error).not.toBeNull()
    await goOut(a.data.id)
    expect(await read()).not.toBeNull()
    const cleared = await svc()
      .from('deliveries')
      .update({ dispatched_at: null })
      .eq('id', a.data.id)
    expect(cleared.error).not.toBeNull()
    await fail(a.data.id)
    // a FAILED delivery cannot be cancelled behind the RPC's back either
    const cancelled = await svc()
      .from('deliveries')
      .update({ status: 'CANCELLED', cancelled_reason: 'x' })
      .eq('id', a.data.id)
    expect(cancelled.error).not.toBeNull()
  })

  it('permissions are unchanged: only Admin/Warehouse move goods, only the planner cancels', async () => {
    const w = await splitWorld()
    const order = await splitOrder(w, 10)
    const a = await plan(order, 5, w.x)
    await step(warehouse, a.data.id, 'ready')
    expect((await step(sale, a.data.id, 'dispatch')).error?.code).toBe('42501')
    expect((await step(store, a.data.id, 'cancel', 'x')).error?.code).toBe('42501')
    await step(warehouse, a.data.id, 'dispatch')
    expect((await step(sale, a.data.id, 'fail', 'x')).error?.code).toBe('42501')
  })
})
