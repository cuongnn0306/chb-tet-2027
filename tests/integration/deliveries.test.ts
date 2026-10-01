/* eslint-disable @typescript-eslint/no-explicit-any -- RPC results are dynamic JSON; the tests assert on their shape */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database.generated'
import { TEST_PASSWORD, TEST_USERS, getLocalConfig, serviceClient } from './helpers'

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

function tomorrow(offset = 1) {
  const d = new Date(Date.now() + (offset + 1) * 86400000)
  return d.toISOString().slice(0, 10)
}

/** Isolated product + location with stock in two batches. */
async function world(stock = 20) {
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data: product } = await svc()
    .from('products')
    .insert({
      sku: `P-DL-${tag}`,
      name: `Bánh giao ${tag}`,
      list_price: 100000,
      default_commission_rate: 0,
    })
    .select('id')
    .single()
  const { data: location } = await svc()
    .from('locations')
    .insert({ code: `DL-${tag}`, name: `Kho giao ${tag}`, location_type: 'STORE', region: 'HN' })
    .select('id')
    .single()
  const w = { productId: product?.id as string, locationId: location?.id as string }
  for (const [qty, expiry] of [
    [stock, '2027-06-01'],
    [stock, '2026-12-01'],
  ] as const) {
    const { data: batch } = await admin
      .from('product_batches')
      .insert({
        batch_code: `B-${randomUUID().slice(0, 6)}`,
        product_id: w.productId,
        manufactured_date: '2026-09-01',
        expiry_date: expiry,
      })
      .select('id')
      .single()
    const res = await rpc(admin, 'record_opening_stock', {
      p_location_id: w.locationId,
      p_product_id: w.productId,
      p_batch_id: batch?.id,
      p_quantity: qty,
    })
    expect(res.error).toBeNull()
  }
  return w
}

/** A confirmed order owned by `sale`, allocated (RESERVED). */
async function reservedOrder(w: { productId: string; locationId: string }, qty: number) {
  const { data, error } = await rpc(sale, 'save_draft_order', {
    p_order_id: null,
    p_customer_id: customer,
    p_items: [{ product_id: w.productId, quantity: qty }],
    p_discount_amount: 0,
    p_creation_location_id: w.locationId,
  })
  expect(error).toBeNull()
  expect((await act(sale, data.id, 'submit')).error).toBeNull()
  expect((await act(admin, data.id, 'confirm')).error).toBeNull()
  // Deposit rules are covered by the payment tests: stand in with the allowed jump to CONFIRMED.
  await svc().from('orders').update({ status: 'CONFIRMED' }).eq('id', data.id)
  const alloc = await rpc(admin, 'allocate_order', { p_order_id: data.id })
  expect(alloc.error).toBeNull()
  const { data: items } = await svc().from('order_items').select('id').eq('order_id', data.id)
  return {
    id: data.id as string,
    itemId: items?.[0]?.id as string,
    code: data.order_code as string,
  }
}

async function plan(
  client: AppSupabaseClient,
  order: { id: string; itemId: string },
  qty: number,
  w: { locationId: string },
  over: Record<string, unknown> = {},
) {
  return rpc(client, 'save_delivery', {
    p_delivery_id: null,
    p_order_id: order.id,
    p_scheduled_date: tomorrow(),
    p_items: [{ order_item_id: order.itemId, quantity: qty }],
    p_delivery_address: '12 Phố Huế, Hà Nội',
    p_source_location_id: w.locationId,
    ...over,
  })
}

const orderRow = async (id: string) =>
  (await svc().from('orders').select('status, paid_amount, remaining_amount').eq('id', id).single())
    .data
const itemRow = async (id: string) =>
  (
    await svc()
      .from('order_items')
      .select('quantity, delivered_quantity, allocated_quantity')
      .eq('id', id)
      .single()
  ).data
const balance = async (w: { locationId: string; productId: string }) => {
  const { data } = await svc()
    .from('inventory_balances')
    .select('available_qty, reserved_qty')
    .eq('location_id', w.locationId)
    .eq('product_id', w.productId)
  return {
    available: (data ?? []).reduce((s, r) => s + r.available_qty, 0),
    reserved: (data ?? []).reduce((s, r) => s + r.reserved_qty, 0),
  }
}

describe('planning deliveries (DEL-001..005)', () => {
  it('an order can have several deliveries, numbered by order code, and the quantities cannot exceed the order', async () => {
    const w = await world()
    const order = await reservedOrder(w, 10)
    const d1 = await plan(sale, order, 4, w)
    expect(d1.error).toBeNull()
    expect(d1.data.delivery_code).toBe(`${order.code}-01`)
    expect(d1.data.recipient_phone).toBeTruthy() // defaulted from the customer
    const d2 = await plan(sale, order, 6, w)
    expect(d2.error).toBeNull()
    expect(d2.data.delivery_code).toBe(`${order.code}-02`)
    const over = await plan(sale, order, 1, w)
    expect(over.error?.message).toMatch(/vượt số lượng đặt/)
  })

  it('cancelling a delivery frees its quantity again', async () => {
    const w = await world()
    const order = await reservedOrder(w, 5)
    const d1 = await plan(sale, order, 5, w)
    expect((await plan(sale, order, 1, w)).error).not.toBeNull()
    expect((await step(sale, d1.data.id, 'cancel')).error?.message).toMatch(/lý do/)
    expect((await step(sale, d1.data.id, 'cancel', 'Khách đổi lịch')).error).toBeNull()
    expect((await plan(sale, order, 5, w)).error).toBeNull()
  })

  it('validates the plan: past date, empty items, foreign order lines, missing address', async () => {
    const w = await world()
    const order = await reservedOrder(w, 5)
    expect(
      (await plan(sale, order, 1, w, { p_scheduled_date: '2020-01-01' })).error?.message,
    ).toMatch(/Ngày giao/)
    expect((await plan(sale, order, 1, w, { p_items: [] })).error?.message).toMatch(
      /ít nhất một sản phẩm/,
    )
    expect((await plan(sale, order, 0, w)).error?.message).toMatch(/số nguyên dương/)
    const stranger = await reservedOrder(w, 5)
    expect(
      (
        await plan(sale, order, 1, w, {
          p_items: [{ order_item_id: stranger.itemId, quantity: 1 }],
        })
      ).error?.message,
    ).toMatch(/không thuộc đơn/)
    // a pickup needs no address; other methods do (customer 0900000003 has none stored)
    const noAddress = await plan(sale, order, 1, w, {
      p_delivery_address: null,
      p_delivery_method: 'CUSTOMER_PICKUP',
    })
    expect(noAddress.error).toBeNull()
  })

  it('only the order owner (and Admin) may plan; Warehouse and other sales roles may not', async () => {
    const w = await world()
    const order = await reservedOrder(w, 5)
    expect((await plan(warehouse, order, 1, w)).error?.code).toBe('42501')
    expect((await plan(store, order, 1, w)).error?.code).toBe('42501')
    expect((await plan(admin, order, 1, w)).error).toBeNull()
  })

  it('a PREPARING delivery can be edited; after READY it cannot', async () => {
    const w = await world()
    const order = await reservedOrder(w, 10)
    const d = await plan(sale, order, 3, w)
    const edit = await rpc(sale, 'save_delivery', {
      p_delivery_id: d.data.id,
      p_order_id: order.id,
      p_scheduled_date: tomorrow(2),
      p_items: [{ order_item_id: order.itemId, quantity: 7 }],
      p_delivery_address: '5 Lý Thường Kiệt',
      p_source_location_id: w.locationId,
    })
    expect(edit.error).toBeNull()
    expect(edit.data.delivery_address).toBe('5 Lý Thường Kiệt')
    const { data: items } = await svc()
      .from('delivery_items')
      .select('quantity')
      .eq('delivery_id', d.data.id)
    expect(items).toEqual([{ quantity: 7 }])
    expect((await step(warehouse, d.data.id, 'ready')).error).toBeNull()
    const again = await rpc(sale, 'save_delivery', {
      p_delivery_id: d.data.id,
      p_order_id: order.id,
      p_scheduled_date: tomorrow(2),
      p_items: [{ order_item_id: order.itemId, quantity: 2 }],
      p_delivery_address: 'x',
      p_source_location_id: w.locationId,
    })
    expect(again.error?.message).toMatch(/Chỉ sửa được đợt giao đang chuẩn bị/)
  })

  it('deliveries cannot be written or deleted directly, even by Admin', async () => {
    const w = await world()
    const order = await reservedOrder(w, 5)
    const d = await plan(sale, order, 1, w)
    expect(
      (await admin.from('deliveries').update({ status: 'DELIVERED' }).eq('id', d.data.id)).error,
    ).not.toBeNull()
    expect((await admin.from('deliveries').delete().eq('id', d.data.id)).error).not.toBeNull()
    const direct = await svc().from('deliveries').delete().eq('id', d.data.id)
    expect(direct.error?.message).toMatch(/Không được xóa đợt giao/)
  })
})

describe('fulfilment: stock leaves at DELIVERED, order follows (DEL-006, DEL-011..013)', () => {
  it('walks PREPARING → READY → OUT → DELIVERED, consumes reserved stock FEFO and completes a fully paid order', async () => {
    const w = await world()
    const order = await reservedOrder(w, 10)
    expect((await orderRow(order.id))?.status).toBe('RESERVED')
    const d = await plan(sale, order, 10, w)
    expect((await orderRow(order.id))?.status).toBe('PREPARING')

    expect((await step(production, d.data.id, 'ready')).error?.code).toBe('42501')
    expect((await step(sale, d.data.id, 'ready')).error?.code).toBe('42501')
    expect((await step(warehouse, d.data.id, 'dispatch')).error?.message).toMatch(/đã sẵn sàng/)
    expect((await step(warehouse, d.data.id, 'ready')).error).toBeNull()
    expect((await orderRow(order.id))?.status).toBe('WAITING_DELIVERY')
    expect((await step(warehouse, d.data.id, 'deliver')).error?.message).toMatch(/đang đi giao/)

    const before = await balance(w)
    expect((await step(warehouse, d.data.id, 'dispatch')).error).toBeNull()
    expect(await balance(w)).toEqual(before) // goods left the building, ledger moves at DELIVERED
    expect((await step(warehouse, d.data.id, 'deliver')).error).toBeNull()

    const after = await balance(w)
    expect(after.available).toBe(before.available - 10)
    expect(after.reserved).toBe(before.reserved - 10)
    expect(await itemRow(order.itemId)).toMatchObject({
      delivered_quantity: 10,
      allocated_quantity: 0,
    })
    // the cache still reconciles with the ledger and the active reservations
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])

    const { data: movements } = await svc()
      .from('inventory_movements')
      .select('movement_type, quantity, delivery_id')
      .eq('delivery_id', d.data.id)
    expect(movements?.length).toBeGreaterThan(0)
    expect(movements?.every((m) => m.movement_type === 'SALE_OUT')).toBe(true)
    // Not paid yet: delivered but not completed
    expect((await orderRow(order.id))?.status).toBe('WAITING_DELIVERY')

    // The last payment completes it (E06 hook)
    const paid = await rpc(admin, 'record_payment', {
      p_order_id: order.id,
      p_method: 'CASH',
      p_amount: 1000000,
    })
    expect(paid.error).toBeNull()
    expect((await orderRow(order.id))?.status).toBe('COMPLETED')
  })

  it('consumes the earlier-expiry batch first and tolerates a partial delivery', async () => {
    const w = await world(20)
    const order = await reservedOrder(w, 25)
    const d1 = await plan(sale, order, 5, w)
    for (const a of ['ready', 'dispatch', 'deliver'])
      expect((await step(warehouse, d1.data.id, a)).error).toBeNull()
    expect(await itemRow(order.itemId)).toMatchObject({
      delivered_quantity: 5,
      allocated_quantity: 20,
    })
    const { data: lots } = await svc()
      .from('inventory_reservations')
      .select('status, quantity, product_batches(expiry_date)')
      .eq('order_item_id', order.itemId)
      .order('status')
    const consumed = lots?.filter((l) => l.status === 'CONSUMED') ?? []
    expect(consumed).toHaveLength(1)
    expect((consumed[0]!.product_batches as any).expiry_date).toBe('2026-12-01')
    expect((await orderRow(order.id))?.status).toBe('WAITING_DELIVERY')
  })

  it('a completed order needs full delivery AND zero remaining amount', async () => {
    const w = await world()
    const order = await reservedOrder(w, 4)
    await rpc(admin, 'record_payment', {
      p_order_id: order.id,
      p_method: 'CASH',
      p_amount: 400000,
    })
    expect((await orderRow(order.id))?.remaining_amount).toBe(0)
    expect((await orderRow(order.id))?.status).toBe('RESERVED')
    const d1 = await plan(sale, order, 2, w)
    for (const a of ['ready', 'dispatch', 'deliver']) await step(warehouse, d1.data.id, a)
    expect((await orderRow(order.id))?.status).toBe('WAITING_DELIVERY')
    const d2 = await plan(sale, order, 2, w)
    for (const a of ['ready', 'dispatch', 'deliver']) await step(warehouse, d2.data.id, a)
    expect((await orderRow(order.id))?.status).toBe('COMPLETED')
  })

  it('a failed delivery keeps the reservation, needs a reason and can be rescheduled', async () => {
    const w = await world()
    const order = await reservedOrder(w, 5)
    const d = await plan(sale, order, 5, w)
    await step(warehouse, d.data.id, 'ready')
    await step(warehouse, d.data.id, 'dispatch')
    expect((await step(warehouse, d.data.id, 'fail')).error?.message).toMatch(/lý do/)
    const before = await balance(w)
    expect((await step(warehouse, d.data.id, 'fail', 'Khách vắng nhà')).error).toBeNull()
    expect(await balance(w)).toEqual(before)
    expect((await itemRow(order.itemId))?.delivered_quantity).toBe(0)

    expect(
      (
        await rpc(warehouse, 'reschedule_delivery', {
          p_delivery_id: d.data.id,
          p_scheduled_date: '2020-01-01',
        })
      ).error?.message,
    ).toMatch(/từ hôm nay/)
    const re = await rpc(warehouse, 'reschedule_delivery', {
      p_delivery_id: d.data.id,
      p_scheduled_date: tomorrow(3),
    })
    expect(re.error).toBeNull()
    expect(re.data).toMatchObject({ status: 'READY', scheduled_date: tomorrow(3) })
  })

  it('refuses to dispatch when the stock is not allocated at the source location', async () => {
    const w = await world()
    const order = await reservedOrder(w, 5)
    const other = await world()
    const d = await plan(sale, order, 5, w, { p_source_location_id: other.locationId })
    await step(warehouse, d.data.id, 'ready')
    const res = await step(warehouse, d.data.id, 'dispatch')
    expect(res.error?.message).toMatch(/Chưa đủ hàng đã phân bổ/)
    const sched = await rpc(admin, 'delivery_schedule', { p_from: tomorrow(), p_to: tomorrow() })
    expect(sched.data.find((r: any) => r.delivery_id === d.data.id).stock_risk).toBe(true)
  })

  it('cannot plan or ship for an order that has not been allocated, and an OUT delivery cannot be cancelled', async () => {
    const w = await world()
    const order = await reservedOrder(w, 5)
    const d = await plan(sale, order, 5, w)
    await step(warehouse, d.data.id, 'ready')
    await step(warehouse, d.data.id, 'dispatch')
    expect((await step(sale, d.data.id, 'cancel', 'đổi ý')).error?.message).toMatch(/đã xuất kho/)

    const w2 = await world()
    const { data: draft } = await rpc(sale, 'save_draft_order', {
      p_order_id: null,
      p_customer_id: customer,
      p_items: [{ product_id: w2.productId, quantity: 2 }],
      p_discount_amount: 0,
      p_creation_location_id: w2.locationId,
    })
    const { data: it } = await svc().from('order_items').select('id').eq('order_id', draft.id)
    // A draft can already carry a plan, but nothing can move before the order is RESERVED
    const planned = await plan(sale, { id: draft.id, itemId: it?.[0]?.id }, 2, w2)
    expect(planned.error).toBeNull()
    expect((await step(warehouse, planned.data.id, 'ready')).error?.message).toMatch(
      /chưa được phân bổ/,
    )
  })
})

describe('delivery board and notes (DEL-007..010, DEL-014/015)', () => {
  it('shows Admin/Warehouse everything and a salesperson only their own orders', async () => {
    const w = await world()
    const order = await reservedOrder(w, 6)
    const d = await plan(sale, order, 6, w)
    const range = { p_from: tomorrow(), p_to: tomorrow(5) }
    const asWh = await rpc(warehouse, 'delivery_schedule', range)
    const row = asWh.data.find((r: any) => r.delivery_id === d.data.id)
    expect(row).toMatchObject({ order_code: order.code, total_quantity: 6, stock_risk: false })
    expect(row.lines[0].quantity).toBe(6)
    expect(
      (await rpc(sale, 'delivery_schedule', range)).data.some(
        (r: any) => r.delivery_id === d.data.id,
      ),
    ).toBe(true)
    expect(
      (await rpc(store, 'delivery_schedule', range)).data.some(
        (r: any) => r.delivery_id === d.data.id,
      ),
    ).toBe(false)
    expect((await rpc(production, 'delivery_schedule', range)).error?.code).toBe('42501')
    const filtered = await rpc(admin, 'delivery_schedule', { ...range, p_statuses: ['READY'] })
    expect(filtered.data.some((r: any) => r.delivery_id === d.data.id)).toBe(false)
    expect(
      (await rpc(admin, 'delivery_schedule', { p_from: tomorrow(9), p_to: tomorrow() })).error,
    ).not.toBeNull()
  })

  it('gives each open delivery its own slice of the FEFO pick list, so nothing is picked twice', async () => {
    const w = await world(20)
    const order = await reservedOrder(w, 25) // reserved: 20 from the 2026-12-01 batch + 5 from 2027-06-01
    const first = await plan(sale, order, 5, w)
    const second = await plan(sale, order, 20, w)
    const pickOf = async (id: string) =>
      (await rpc(warehouse, 'delivery_detail', { p_delivery_id: id })).data.items[0].pick as {
        expiry_date: string
        quantity: number
      }[]
    const p1 = await pickOf(first.data.id)
    const p2 = await pickOf(second.data.id)
    expect(p1).toEqual([expect.objectContaining({ expiry_date: '2026-12-01', quantity: 5 })])
    expect(p2).toEqual([
      expect.objectContaining({ expiry_date: '2026-12-01', quantity: 15 }),
      expect.objectContaining({ expiry_date: '2027-06-01', quantity: 5 }),
    ])
    const total = [...p1, ...p2].reduce((s, p) => s + p.quantity, 0)
    expect(total).toBe(25)
  })

  it('returns the print data with a FEFO pick list, only to people who may see the delivery', async () => {
    const w = await world(20)
    const order = await reservedOrder(w, 25)
    const d = await plan(sale, order, 25, w)
    const detail = await rpc(warehouse, 'delivery_detail', { p_delivery_id: d.data.id })
    expect(detail.error).toBeNull()
    expect(detail.data.order.order_code).toBe(order.code)
    const pick = detail.data.items[0].pick
    expect(pick.map((p: any) => p.expiry_date)).toEqual(['2026-12-01', '2027-06-01'])
    expect(pick.reduce((s: number, p: any) => s + p.quantity, 0)).toBe(25)
    expect((await rpc(sale, 'delivery_detail', { p_delivery_id: d.data.id })).error).toBeNull()
    expect((await rpc(store, 'delivery_detail', { p_delivery_id: d.data.id })).error?.code).toBe(
      '42501',
    )
  })
})

describe('concurrency', () => {
  it('two simultaneous plans cannot over-assign the same order line', async () => {
    const w = await world()
    const order = await reservedOrder(w, 5)
    const results = await Promise.all([plan(sale, order, 4, w), plan(sale, order, 4, w)])
    expect(results.filter((r) => r.error === null)).toHaveLength(1)
    const { data } = await svc()
      .from('delivery_items')
      .select('quantity')
      .eq('order_item_id', order.itemId)
    expect((data ?? []).reduce((s, r) => s + r.quantity, 0)).toBe(4)
  })
})
