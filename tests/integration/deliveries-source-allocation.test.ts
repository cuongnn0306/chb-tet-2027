/* eslint-disable @typescript-eslint/no-explicit-any -- RPC results are dynamic JSON; the tests assert on their shape */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database.generated'
import { TEST_PASSWORD, TEST_USERS, getLocalConfig, serviceClient } from './helpers'

/**
 * DEL-005 (review RV-06): stock is allocated per delivery, per order line and per source location.
 * One SKU can be split across two warehouses; nothing is reserved twice; goods already delivered are
 * never re-reserved; a shortage at one source changes nothing anywhere.
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
const allocate = (client: AppSupabaseClient, id: string, belowSafety = false) =>
  rpc(client, 'allocate_delivery_stock', { p_delivery_id: id, p_allow_below_safety: belowSafety })

function inDays(days: number) {
  return new Date(Date.now() + (days + 1) * 86400000).toISOString().slice(0, 10)
}

interface World {
  productId: string
  x: string
  y: string
}

async function addStock(productId: string, locationId: string, qty: number, expiry = '2027-06-01') {
  const { data: batch } = await admin
    .from('product_batches')
    .insert({
      batch_code: `B-${randomUUID().slice(0, 6)}`,
      product_id: productId,
      manufactured_date: '2026-09-01',
      expiry_date: expiry,
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
  return batch?.id as string
}

/** One product with two source locations: `atX` units at X and `atY` units at Y. */
async function world(atX = 10, atY = 10): Promise<World> {
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data: product } = await svc()
    .from('products')
    .insert({
      sku: `P-SA-${tag}`,
      name: `Bánh phân bổ ${tag}`,
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
        code: `SA${code}-${tag}`,
        name: `Kho ${code} ${tag}`,
        location_type: 'STORE',
        region: 'HN',
      })
      .select('id')
      .single()
    if (qty > 0) await addStock(productId, loc?.id as string, qty)
    locations.push(loc?.id as string)
  }
  return { productId, x: locations[0] as string, y: locations[1] as string }
}

/** A CONFIRMED order created at X; nothing is allocated yet. */
async function confirmedOrder(w: World, qty: number) {
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
  const { data: items } = await svc().from('order_items').select('id').eq('order_id', data.id)
  return { id: data.id as string, itemId: items?.[0]?.id as string }
}

type Order = Awaited<ReturnType<typeof confirmedOrder>>

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

const itemRow = async (id: string) =>
  (
    await svc()
      .from('order_items')
      .select('delivered_quantity, allocated_quantity')
      .eq('id', id)
      .single()
  ).data

const orderStatus = async (id: string) =>
  (await svc().from('orders').select('status').eq('id', id).single()).data?.status as string

const soldFor = async (deliveryId: string) =>
  (
    (
      await svc()
        .from('inventory_movements')
        .select('batch_id, quantity, from_location_id')
        .eq('delivery_id', deliveryId)
        .eq('movement_type', 'SALE_OUT')
    ).data ?? []
  ).map((m) => ({ batch: m.batch_id, qty: m.quantity, from: m.from_location_id }))

describe('allocation per delivery and source location (DEL-005, RV-06)', () => {
  it('blocks a sibling from dispatching against another delivery’s coverage, including concurrent attempts', async () => {
    const w = await world(5, 5)
    const order = await confirmedOrder(w, 10)
    expect(
      (await rpc(admin, 'allocate_order', { p_order_id: order.id, p_location_id: w.x })).error,
    ).toBeNull()
    expect(
      (await rpc(admin, 'allocate_order', { p_order_id: order.id, p_location_id: w.y })).error,
    ).toBeNull()
    const d1 = (await plan(order, 5, w.x)).data
    const d2 = (await plan(order, 5, w.x)).data
    expect((await step(warehouse, d1.id, 'ready')).error).toBeNull()
    expect((await step(warehouse, d2.id, 'ready')).error).toBeNull()

    const [first, second] = await Promise.all([
      step(warehouse, d1.id, 'dispatch'),
      step(admin, d2.id, 'dispatch'),
    ])
    expect(first.error).toBeNull()
    expect(second.error?.message).toMatch(/thiếu 5.*kho.*phân bổ.*điều chuyển/)
    expect(
      (await svc().from('deliveries').select('status').eq('id', d2.id).single()).data?.status,
    ).toBe('READY')
    expect(await soldFor(d1.id)).toEqual([])
    expect(await soldFor(d2.id)).toEqual([])
    expect(await reservedAt(order.itemId, w.x)).toBe(5)

    await addStock(w.productId, w.x, 5)
    expect((await allocate(warehouse, d2.id)).data).toMatchObject({
      fully_allocated: true,
      allocated_total: 5,
      released_total: 5,
    })
    expect((await step(warehouse, d2.id, 'dispatch')).error).toBeNull()
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('binds pooled stock to the delivery that dispatches before counting it as exported', async () => {
    const w = await world(10, 0)
    const order = await confirmedOrder(w, 10)
    expect((await rpc(admin, 'allocate_order', { p_order_id: order.id })).error).toBeNull()
    const d1 = (await plan(order, 5, w.x)).data
    const d2 = (await plan(order, 5, w.x)).data
    expect((await step(warehouse, d2.id, 'ready')).error).toBeNull()
    expect((await step(warehouse, d2.id, 'dispatch')).error).toBeNull()

    const { data: d2Items } = await svc()
      .from('delivery_items')
      .select('id')
      .eq('delivery_id', d2.id)
    const { data: bound } = await svc()
      .from('delivery_item_batches')
      .select('quantity')
      .eq('delivery_item_id', d2Items?.[0]?.id as string)
    expect(bound?.reduce((sum, row) => sum + row.quantity, 0)).toBe(5)
    expect(await soldFor(d2.id)).toEqual([])

    await goOut(d1.id)
    expect((await step(warehouse, d2.id, 'deliver')).error).toBeNull()
    expect((await step(warehouse, d1.id, 'deliver')).error).toBeNull()
    expect((await itemRow(order.itemId))?.delivered_quantity).toBe(10)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('splits one SKU across two warehouses and never reserves twice', async () => {
    const w = await world()
    const order = await confirmedOrder(w, 10)
    const d1 = (await plan(order, 5, w.x)).data
    const d2 = (await plan(order, 5, w.y)).data

    const a1 = await allocate(warehouse, d1.id)
    expect(a1.error).toBeNull()
    expect(a1.data).toMatchObject({ fully_allocated: true, allocated_total: 5, released_total: 0 })
    expect(await reservedAt(order.itemId, w.x)).toBe(5)
    expect(await orderStatus(order.id)).toBe('CONFIRMED') // not every unit is covered yet

    const a2 = await allocate(warehouse, d2.id)
    expect(a2.error).toBeNull()
    expect(a2.data).toMatchObject({ fully_allocated: true, allocated_total: 5 })
    expect(await reservedAt(order.itemId, w.y)).toBe(5)
    expect(['RESERVED', 'PREPARING', 'WAITING_DELIVERY']).toContain(await orderStatus(order.id))
    expect((await itemRow(order.itemId))?.allocated_quantity).toBe(10)

    // repeating is a no-op
    const again = await allocate(warehouse, d2.id)
    expect(again.data).toMatchObject({
      fully_allocated: true,
      allocated_total: 0,
      released_total: 0,
    })
    expect(await reservedAt(order.itemId, w.x)).toBe(5)
    expect(await reservedAt(order.itemId, w.y)).toBe(5)

    // each delivery leaves from its own source; SALE_OUT only at DELIVERED
    await goOut(d1.id)
    await goOut(d2.id)
    expect(await soldFor(d1.id)).toEqual([])
    expect((await step(warehouse, d1.id, 'deliver')).error).toBeNull()
    expect((await step(warehouse, d2.id, 'deliver')).error).toBeNull()
    expect((await soldFor(d1.id)).map((m) => [m.qty, m.from])).toEqual([[5, w.x]])
    expect((await soldFor(d2.id)).map((m) => [m.qty, m.from])).toEqual([[5, w.y]])
    expect((await itemRow(order.itemId))?.delivered_quantity).toBe(10)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('moves an order-wide allocation at the creation location to the second source without double-reserving', async () => {
    const w = await world()
    const order = await confirmedOrder(w, 10)
    expect((await rpc(admin, 'allocate_order', { p_order_id: order.id })).error).toBeNull()
    expect(await reservedAt(order.itemId, w.x)).toBe(10)

    const d1 = (await plan(order, 5, w.x)).data
    const d2 = (await plan(order, 5, w.y)).data
    await step(warehouse, d2.id, 'ready')
    const blocked = await step(warehouse, d2.id, 'dispatch')
    expect(blocked.error?.message).toMatch(/phân bổ/)

    const status = await rpc(warehouse, 'delivery_allocation_status', { p_delivery_id: d2.id })
    expect(status.error).toBeNull()
    expect(status.data).toMatchObject({ can_allocate: true, fully_covered: false })
    expect(status.data.lines[0].held_elsewhere[0]).toMatchObject({ quantity: 10, releasable: 5 })

    const res = await allocate(warehouse, d2.id)
    expect(res.error).toBeNull()
    expect(res.data).toMatchObject({ allocated_total: 5, released_total: 5 })
    expect(await reservedAt(order.itemId, w.x)).toBe(5)
    expect(await reservedAt(order.itemId, w.y)).toBe(5)
    expect((await itemRow(order.itemId))?.allocated_quantity).toBe(10)

    // d1 at X still has its own 5, d2 at Y can now go
    await goOut(d1.id)
    expect((await step(warehouse, d2.id, 'dispatch')).error).toBeNull()
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('a shortage at one source changes nothing at any source', async () => {
    const w = await world(10, 3)
    const order = await confirmedOrder(w, 10)
    expect((await rpc(admin, 'allocate_order', { p_order_id: order.id })).error).toBeNull()
    const d2 = (await plan(order, 5, w.y)).data

    const res = await allocate(warehouse, d2.id)
    expect(res.error).toBeNull()
    expect(res.data).toMatchObject({
      fully_allocated: false,
      shortage_total: 2,
      allocated_total: 0,
    })
    expect(await reservedAt(order.itemId, w.y)).toBe(0)
    expect(await reservedAt(order.itemId, w.x)).toBe(10)
    expect((await itemRow(order.itemId))?.allocated_quantity).toBe(10)

    const status = await rpc(warehouse, 'delivery_allocation_status', { p_delivery_id: d2.id })
    expect(status.data.lines[0].shortage).toBe(2)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('after a partial delivery only the remaining quantity is allocated at the other source', async () => {
    const w = await world()
    const order = await confirmedOrder(w, 10)
    expect((await rpc(admin, 'allocate_order', { p_order_id: order.id })).error).toBeNull()
    const d1 = (await plan(order, 4, w.x)).data
    await goOut(d1.id)
    expect((await step(warehouse, d1.id, 'deliver')).error).toBeNull()
    const soldBefore = await soldFor(d1.id)
    expect(soldBefore.map((m) => m.qty)).toEqual([4])
    expect(await reservedAt(order.itemId, w.x)).toBe(6)

    const d2 = (await plan(order, 6, w.y)).data
    const res = await allocate(warehouse, d2.id)
    expect(res.error).toBeNull()
    expect(res.data).toMatchObject({ allocated_total: 6, released_total: 6 })
    // the delivered 4 were not reserved again: 6 in total, all at Y
    expect(await reservedAt(order.itemId, w.y)).toBe(6)
    expect(await reservedAt(order.itemId, w.x)).toBe(0)
    expect(await itemRow(order.itemId)).toEqual({ delivered_quantity: 4, allocated_quantity: 6 })
    // delivered history untouched
    expect(await soldFor(d1.id)).toEqual(soldBefore)

    await goOut(d2.id)
    expect((await step(warehouse, d2.id, 'deliver')).error).toBeNull()
    expect((await itemRow(order.itemId))?.delivered_quantity).toBe(10)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('repeated and concurrent allocation never reserves more than the delivery needs', async () => {
    const w = await world()
    const order = await confirmedOrder(w, 10)
    const d1 = (await plan(order, 5, w.x)).data
    const d2 = (await plan(order, 5, w.y)).data

    const [r1, r2] = await Promise.all([allocate(warehouse, d1.id), allocate(admin, d1.id)])
    expect(r1.error).toBeNull()
    expect(r2.error).toBeNull()
    expect([r1.data.allocated_total, r2.data.allocated_total].sort()).toEqual([0, 5])
    expect(await reservedAt(order.itemId, w.x)).toBe(5)

    // the same delivery allocated twice at once: the second call finds nothing left to reserve
    const [a, b] = await Promise.all([allocate(warehouse, d2.id), allocate(warehouse, d2.id)])
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    expect(await reservedAt(order.itemId, w.y)).toBe(5)
    expect((await itemRow(order.itemId))?.allocated_quantity).toBe(10)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('a batch allocated after a sibling left the warehouse is not double-booked', async () => {
    const w = await world(0, 0)
    const late = await addStock(w.productId, w.x, 3, '2027-06-01')
    await addStock(w.productId, w.y, 2, '2027-06-01')
    const order = await confirmedOrder(w, 5)
    // order-wide allocation: 3 at X (all it has) and the other 2 at Y -> RESERVED
    expect(
      (await rpc(admin, 'allocate_order', { p_order_id: order.id, p_location_id: w.x })).error,
    ).toBeNull()
    const full = await rpc(admin, 'allocate_order', { p_order_id: order.id, p_location_id: w.y })
    expect(full.data.fully_allocated).toBe(true)

    // d1 leaves X bound to the only batch X has
    const d1 = (await plan(order, 3, w.x)).data
    await goOut(d1.id)

    // earlier-expiring stock arrives at X afterwards; d2 (2 from X) is allocated from it
    const early = await addStock(w.productId, w.x, 2, '2027-03-01')
    const d2 = (await plan(order, 2, w.x)).data
    const res = await allocate(warehouse, d2.id)
    expect(res.error).toBeNull()
    expect(res.data).toMatchObject({ allocated_total: 2, released_total: 2 })
    expect(await reservedAt(order.itemId, w.x)).toBe(5)
    expect(await reservedAt(order.itemId, w.y)).toBe(0)

    await goOut(d2.id)
    expect((await step(warehouse, d1.id, 'deliver')).error).toBeNull()
    expect((await step(warehouse, d2.id, 'deliver')).error).toBeNull()
    const sold = [...(await soldFor(d1.id)), ...(await soldFor(d2.id))]
    const byBatch = (b: string) => sold.filter((m) => m.batch === b).reduce((s, m) => s + m.qty, 0)
    expect(byBatch(late)).toBe(3)
    expect(byBatch(early)).toBe(2)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('is limited to Admin and Warehouse, and safety stock is Admin only', async () => {
    const w = await world()
    const order = await confirmedOrder(w, 4)
    const d = (await plan(order, 4, w.x)).data

    for (const client of [sale, store]) {
      expect((await allocate(client, d.id)).error?.code).toBe('42501')
      expect(
        (await rpc(client, 'delivery_allocation_status', { p_delivery_id: d.id })).error?.code,
      ).toBe('42501')
    }
    expect((await allocate(warehouse, d.id, true)).error?.code).toBe('42501')
    expect(await reservedAt(order.itemId, w.x)).toBe(0)

    // clients cannot write the attribution table or the reservations directly
    const direct = await (sale as any).from('delivery_stock_allocations').select('id')
    expect((direct.data ?? []).length).toBe(0)
    expect((await allocate(admin, d.id)).error).toBeNull()
  })

  it('refuses deliveries that already left or closed orders, and audits what it did', async () => {
    const w = await world()
    const order = await confirmedOrder(w, 4)
    const d = (await plan(order, 4, w.x)).data
    expect((await allocate(warehouse, d.id)).error).toBeNull()
    expect(['CONFIRMED', 'RESERVED', 'PREPARING', 'WAITING_DELIVERY']).toContain(
      await orderStatus(order.id),
    )

    const { data: logs } = await svc()
      .from('audit_logs')
      .select('action, reason, after_data')
      .eq('entity_type', 'deliveries')
      .eq('entity_id', d.id)
      .eq('action', 'allocate_stock')
    expect(logs?.length).toBe(1)
    expect(logs?.[0]?.reason).toContain(d.delivery_code)
    const { data: rows } = await (svc() as any)
      .from('delivery_stock_allocations')
      .select('quantity')
      .eq('delivery_id', d.id)
    expect((rows as any[]).map((r) => r.quantity)).toEqual([4])

    await goOut(d.id)
    expect((await allocate(warehouse, d.id)).error?.message).toMatch(/đang chuẩn bị hoặc sẵn sàng/)
    // an immutable attribution row cannot be changed even by the service role
    const upd = await (svc() as any)
      .from('delivery_stock_allocations')
      .update({ quantity: 1 })
      .eq('delivery_id', d.id)
    expect(upd.error).not.toBeNull()
  })
})

/** Edit a PREPARING delivery through the existing save_delivery flow (source and/or quantity). */
const editDelivery = (
  order: Order,
  deliveryId: string,
  qty: number,
  source: string,
  client = sale,
) =>
  rpc(client, 'save_delivery', {
    p_delivery_id: deliveryId,
    p_order_id: order.id,
    p_scheduled_date: inDays(1),
    p_items: [{ order_item_id: order.itemId, quantity: qty }],
    p_delivery_address: '12 Phố Huế, Hà Nội',
    p_source_location_id: source,
  })

describe('allocation survives edits of a not-yet-dispatched delivery (DEL-005)', () => {
  it('does not report coverage for a source whose reservation was released (A -> B -> A)', async () => {
    const w = await world()
    const order = await confirmedOrder(w, 5)
    const d = (await plan(order, 5, w.x)).data
    expect((await allocate(warehouse, d.id)).data).toMatchObject({ allocated_total: 5 })
    expect(await reservedAt(order.itemId, w.x)).toBe(5)

    // move the delivery to Y and allocate there: the surplus at X is released
    expect((await editDelivery(order, d.id, 5, w.y)).error).toBeNull()
    expect((await allocate(warehouse, d.id)).data).toMatchObject({
      allocated_total: 5,
      released_total: 5,
    })
    expect(await reservedAt(order.itemId, w.x)).toBe(0)
    expect(await reservedAt(order.itemId, w.y)).toBe(5)

    // back to X: the old attribution row at X is only history, nothing is held there
    expect((await editDelivery(order, d.id, 5, w.x)).error).toBeNull()
    const status = await rpc(warehouse, 'delivery_allocation_status', { p_delivery_id: d.id })
    expect(status.error).toBeNull()
    expect(status.data).toMatchObject({ fully_covered: false, can_allocate: true })
    expect(status.data.lines[0]).toMatchObject({ covered_for_delivery: 0, quantity: 5 })
    // it cannot dispatch from X without stock held there
    expect((await step(warehouse, d.id, 'ready')).error).toBeNull()
    expect((await step(warehouse, d.id, 'dispatch')).error).not.toBeNull()

    // allocating again reserves at X and takes the surplus back from Y: no double hold
    const again = await allocate(warehouse, d.id)
    expect(again.error).toBeNull()
    expect(again.data).toMatchObject({ allocated_total: 5, released_total: 5 })
    expect(await reservedAt(order.itemId, w.x)).toBe(5)
    expect(await reservedAt(order.itemId, w.y)).toBe(0)
    expect((await itemRow(order.itemId))?.allocated_quantity).toBe(5)

    expect((await step(warehouse, d.id, 'dispatch')).error).toBeNull()
    expect((await step(warehouse, d.id, 'deliver')).error).toBeNull()
    expect((await soldFor(d.id)).map((m) => [m.qty, m.from])).toEqual([[5, w.x]])
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('reserves only the difference when the quantity is raised and keeps pooled units when lowered', async () => {
    const w = await world()
    const order = await confirmedOrder(w, 10)
    const d1 = (await plan(order, 5, w.x)).data
    expect((await allocate(warehouse, d1.id)).data).toMatchObject({ allocated_total: 5 })

    // raise 5 -> 8: only 3 more are needed
    expect((await editDelivery(order, d1.id, 8, w.x)).error).toBeNull()
    const raised = await rpc(warehouse, 'delivery_allocation_status', { p_delivery_id: d1.id })
    expect(raised.data.lines[0]).toMatchObject({ covered_for_delivery: 5, quantity: 3 })
    expect((await allocate(warehouse, d1.id)).data).toMatchObject({ allocated_total: 3 })
    expect(await reservedAt(order.itemId, w.x)).toBe(8)

    // lower 8 -> 4: still covered, the extra 4 stay reserved and cover a sibling delivery from X
    expect((await editDelivery(order, d1.id, 4, w.x)).error).toBeNull()
    const lowered = await rpc(warehouse, 'delivery_allocation_status', { p_delivery_id: d1.id })
    expect(lowered.data).toMatchObject({ fully_covered: true })
    const d2 = (await plan(order, 4, w.x)).data
    const second = await allocate(warehouse, d2.id)
    expect(second.error).toBeNull()
    expect(second.data).toMatchObject({ fully_allocated: true, allocated_total: 0 })
    expect(await reservedAt(order.itemId, w.x)).toBe(8)
    expect((await itemRow(order.itemId))?.allocated_quantity).toBe(8)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })
})
