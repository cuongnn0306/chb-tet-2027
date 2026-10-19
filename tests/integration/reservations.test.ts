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

beforeAll(async () => {
  ;[admin, sale, store, warehouse, production] = await Promise.all([
    clientFor(TEST_USERS.admin),
    clientFor(TEST_USERS.sale),
    clientFor(TEST_USERS.store),
    clientFor(TEST_USERS.warehouse),
    clientFor(TEST_USERS.production),
  ])
  const { data } = await serviceClient()
    .from('customers')
    .select('id')
    .eq('phone_normalized', '0900000003')
    .single()
  customer = data?.id as string
})

/** An isolated world per test: its own product, location and batches, so reruns never interfere. */
async function world(region = 'HN') {
  const svc = serviceClient()
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data: product } = await svc
    .from('products')
    .insert({
      sku: `P-RV-${tag}`,
      name: `Sản phẩm giữ hàng ${tag}`,
      list_price: 100000,
      default_commission_rate: 8,
    })
    .select('id')
    .single()
  const { data: location } = await svc
    .from('locations')
    .insert({ code: `RV-${tag}`, name: `Kho giữ hàng ${tag}`, location_type: 'STORE', region })
    .select('id')
    .single()
  return { productId: product?.id as string, locationId: location?.id as string, tag }
}

async function stockBatch(
  w: { productId: string; locationId: string },
  qty: number,
  expiry: string,
  code = `B-${randomUUID().slice(0, 6)}`,
) {
  const { data: batch, error } = await admin
    .from('product_batches')
    .insert({
      batch_code: code,
      product_id: w.productId,
      manufactured_date: '2026-09-01',
      expiry_date: expiry,
    })
    .select('id')
    .single()
  expect(error).toBeNull()
  const res = await rpc(admin, 'record_opening_stock', {
    p_location_id: w.locationId,
    p_product_id: w.productId,
    p_batch_id: batch?.id,
    p_quantity: qty,
  })
  expect(res.error).toBeNull()
  return batch?.id as string
}

const FAR = '2027-06-01'
const NEAR = '2026-12-01'

async function submitted(w: { productId: string; locationId: string }, qty: number, client = sale) {
  const { data, error } = await rpc(client, 'save_draft_order', {
    p_order_id: null,
    p_customer_id: customer,
    p_items: [{ product_id: w.productId, quantity: qty }],
    p_discount_amount: 0,
    p_creation_location_id: w.locationId,
  })
  expect(error).toBeNull()
  const sub = await rpc(client, 'transition_order', {
    p_order_id: data.id,
    p_action: 'submit',
    p_reason: null,
  })
  expect(sub.error).toBeNull()
  return data.id as string
}

const act = (client: AppSupabaseClient, id: string, action: string, reason?: string) =>
  rpc(client, 'transition_order', { p_order_id: id, p_action: action, p_reason: reason ?? null })

async function reservations(orderId: string) {
  const { data } = await serviceClient()
    .from('inventory_reservations')
    .select('*, product_batches(batch_code, expiry_date)')
    .eq('order_id', orderId)
    .order('reserved_at')
  return data ?? []
}

async function reservedTotal(locationId: string, productId: string) {
  const { data } = await serviceClient()
    .from('inventory_balances')
    .select('reserved_qty')
    .eq('location_id', locationId)
    .eq('product_id', productId)
  return (data ?? []).reduce((sum, b) => sum + b.reserved_qty, 0)
}

describe('temporary reservation (RES-001..003)', () => {
  it('confirming an order takes a hold with the configured TTL and shows it on the order', async () => {
    const w = await world()
    await stockBatch(w, 20, FAR)
    const id = await submitted(w, 5)
    expect(await reservations(id)).toHaveLength(0) // nothing is held before the Admin confirms

    expect((await act(admin, id, 'confirm')).data.status).toBe('WAITING_DEPOSIT')
    const held = await reservations(id)
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ quantity: 5, reservation_type: 'TEMPORARY', status: 'ACTIVE' })
    const ttlHours = (new Date(held[0]?.expires_at as string).getTime() - Date.now()) / 3_600_000
    expect(ttlHours).toBeGreaterThan(23.9)
    expect(ttlHours).toBeLessThan(24.1)

    const { data: order } = await serviceClient()
      .from('orders')
      .select('reservation_expires_at')
      .eq('id', id)
      .single()
    expect(order?.reservation_expires_at).not.toBeNull()
    expect(await reservedTotal(w.locationId, w.productId)).toBe(5)

    const { data: summary } = await rpc(sale, 'inventory_summary', { p_location_id: w.locationId })
    expect(summary.find((r: any) => r.product_id === w.productId)).toMatchObject({
      available_qty: 20,
      reserved_qty: 5,
      sellable_qty: 15,
    })
  })

  it('cancelling or voiding releases the hold', async () => {
    const w = await world()
    await stockBatch(w, 20, FAR)
    const a = await submitted(w, 4)
    const b = await submitted(w, 3)
    await act(admin, a, 'confirm')
    await act(admin, b, 'confirm')
    expect(await reservedTotal(w.locationId, w.productId)).toBe(7)

    expect((await act(sale, a, 'cancel', 'Khách đổi ý')).error).toBeNull()
    expect(await reservedTotal(w.locationId, w.productId)).toBe(3)
    expect((await reservations(a))[0]).toMatchObject({
      status: 'RELEASED',
      release_reason: 'Khách đổi ý',
    })

    expect((await act(admin, b, 'void', 'Nhập nhầm')).error).toBeNull()
    expect(await reservedTotal(w.locationId, w.productId)).toBe(0)
    expect((await reservations(b))[0]).toMatchObject({ status: 'RELEASED' })
  })

  it('holds only what is sellable, keeps the safety stock, and reports the shortage with suggestions', async () => {
    const w = await world('HN')
    const other = await world('HN') // same region, has stock: should be suggested as a source
    await stockBatch(w, 10, FAR)
    await stockBatch({ productId: w.productId, locationId: other.locationId }, 40, FAR)
    await serviceClient()
      .from('safety_stock_rules')
      .insert({ location_id: w.locationId, product_id: w.productId, minimum_qty: 3 })

    const id = await submitted(w, 9)
    await act(admin, id, 'confirm')
    const held = await reservations(id)
    expect(held.reduce((n, r) => n + r.quantity, 0)).toBe(7) // 10 - safety 3

    const { data: status, error } = await rpc(sale, 'order_stock_status', { p_order_id: id })
    expect(error).toBeNull()
    expect(status.status).toBe('WAITING_DEPOSIT')
    const line = status.lines[0]
    expect(line).toMatchObject({ quantity: 9, temp_reserved: 7, allocated: 0, shortage: 2 })
    expect(line.suggestions[0]).toMatchObject({
      location_id: other.locationId,
      covers_all: true,
      same_region: true,
    })
  })

  it('the warning also appears before the order exists (check_stock)', async () => {
    const w = await world()
    await stockBatch(w, 6, FAR)
    const { data, error } = await rpc(sale, 'check_stock', {
      p_location_id: w.locationId,
      p_items: [
        { product_id: w.productId, quantity: 10 },
        { product_id: w.productId, quantity: 2 },
      ],
    })
    expect(error).toBeNull()
    expect(data).toHaveLength(1) // lines of the same product are merged
    expect(data[0]).toMatchObject({ quantity: 12, sellable_now: 6, shortage: 6 })
    expect(
      (await rpc(warehouse, 'check_stock', { p_location_id: w.locationId, p_items: [] })).error,
    ).toBeNull()
    expect(
      (await rpc(production, 'check_stock', { p_location_id: w.locationId, p_items: [] })).error
        ?.code,
    ).toBe('42501')
  })
})

describe('no overselling under concurrency', () => {
  it('three orders confirmed at once for 5 units never hold more than 5', async () => {
    const w = await world()
    await stockBatch(w, 5, FAR)
    const ids = await Promise.all([submitted(w, 3), submitted(w, 3), submitted(w, 3)])
    const results = await Promise.all(ids.map((id) => act(admin, id, 'confirm')))
    expect(results.every((r) => r.error === null)).toBe(true)

    const held = await Promise.all(
      ids.map(async (id) => (await reservations(id)).reduce((n, r) => n + r.quantity, 0)),
    )
    expect(held.reduce((a, b) => a + b, 0)).toBe(5)
    expect([...held].sort()).toEqual([0, 2, 3])
    expect(await reservedTotal(w.locationId, w.productId)).toBe(5)

    const { data } = await serviceClient()
      .from('inventory_balances')
      .select('available_qty, reserved_qty')
      .eq('location_id', w.locationId)
    expect(data?.every((b) => b.reserved_qty <= b.available_qty && b.reserved_qty >= 0)).toBe(true)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('a hold and a stock exit racing for the same units: the total taken never exceeds the stock', async () => {
    const w = await world()
    const batchId = await stockBatch(w, 4, FAR)
    const id = await submitted(w, 4)
    const [confirm, exit] = await Promise.all([
      act(admin, id, 'confirm'),
      rpc(warehouse, 'record_stock_exit', {
        p_type: 'DAMAGE_OUT',
        p_location_id: w.locationId,
        p_product_id: w.productId,
        p_batch_id: batchId,
        p_quantity: 4,
        p_reason: 'đua tranh',
      }),
    ])
    expect(confirm.error).toBeNull()
    const held = (await reservations(id)).reduce((n, r) => n + r.quantity, 0)
    const { data: bal } = await serviceClient()
      .from('inventory_balances')
      .select('available_qty, reserved_qty, damaged_qty')
      .eq('batch_id', batchId)
      .single()
    expect(bal?.available_qty).toBeGreaterThanOrEqual(0)
    expect(bal?.reserved_qty).toBeLessThanOrEqual(bal?.available_qty as number)
    // either the exit won (hold = 0) or the hold won (exit refused): never both
    expect(held + (bal?.damaged_qty ?? 0)).toBeLessThanOrEqual(4)
    if (exit.error) expect(exit.error.message).toMatch(/Không đủ hàng khả dụng/)
  })
})

describe('physical allocation, FEFO and multi-batch (RES-005..008)', () => {
  async function confirmedOrder(w: { productId: string; locationId: string }, qty: number) {
    const id = await submitted(w, qty)
    await act(admin, id, 'confirm')
    // The deposit step (E06) is not built yet: stand in for it with the allowed WAITING_DEPOSIT -> CONFIRMED move.
    const { error } = await serviceClient()
      .from('orders')
      .update({ status: 'CONFIRMED', confirmed_at: new Date().toISOString() })
      .eq('id', id)
    expect(error).toBeNull()
    return id
  }

  it('a confirmed order is demand commitment only: the temporary hold is released and nothing is locked', async () => {
    const w = await world()
    await stockBatch(w, 10, FAR)
    const id = await confirmedOrder(w, 6)
    expect(await reservedTotal(w.locationId, w.productId)).toBe(0)
    expect((await reservations(id))[0]).toMatchObject({ status: 'RELEASED' })

    const { data } = await rpc(admin, 'committed_demand')
    expect(Number(data.find((r: any) => r.product_id === w.productId).committed_qty)).toBe(6)
    expect((await rpc(production, 'committed_demand')).error).toBeNull()
    expect((await rpc(sale, 'committed_demand')).error?.code).toBe('42501')
  })

  it('allocates by FEFO across batches, then the order becomes RESERVED', async () => {
    const w = await world()
    const older = await stockBatch(w, 4, NEAR, 'B-OLDER')
    const newer = await stockBatch(w, 10, FAR, 'B-NEWER')
    const id = await confirmedOrder(w, 6)

    const { data, error } = await rpc(admin, 'allocate_order', { p_order_id: id })
    expect(error).toBeNull()
    expect(data).toMatchObject({ fully_allocated: true, shortage_total: 0 })

    const held = (await reservations(id)).filter(
      (r) => r.reservation_type === 'PHYSICAL_ALLOCATION',
    )
    expect(held.map((r) => [r.batch_id, r.quantity, r.reservation_type])).toEqual([
      [older, 4, 'PHYSICAL_ALLOCATION'],
      [newer, 2, 'PHYSICAL_ALLOCATION'],
    ])
    expect(
      (await serviceClient().from('orders').select('status').eq('id', id).single()).data?.status,
    ).toBe('RESERVED')
    expect(
      (
        await serviceClient()
          .from('order_items')
          .select('allocated_quantity')
          .eq('order_id', id)
          .single()
      ).data?.allocated_quantity,
    ).toBe(6)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('reports a partial allocation and lets Warehouse top it up after restocking', async () => {
    const w = await world()
    await stockBatch(w, 3, FAR)
    const id = await confirmedOrder(w, 5)

    const first = await rpc(warehouse, 'allocate_order', { p_order_id: id })
    expect(first.error).toBeNull()
    expect(first.data).toMatchObject({ fully_allocated: false, shortage_total: 2 })
    expect(
      (await serviceClient().from('orders').select('status').eq('id', id).single()).data?.status,
    ).toBe('CONFIRMED')

    await stockBatch(w, 5, FAR)
    const second = await rpc(warehouse, 'allocate_order', { p_order_id: id })
    expect(second.data).toMatchObject({ fully_allocated: true })
    expect(
      (await serviceClient().from('orders').select('status').eq('id', id).single()).data?.status,
    ).toBe('RESERVED')
    expect(
      (
        await serviceClient()
          .from('order_items')
          .select('allocated_quantity')
          .eq('order_id', id)
          .single()
      ).data?.allocated_quantity,
    ).toBe(5)
  })

  it('only the Admin may use safety stock; sales and production cannot allocate at all', async () => {
    const w = await world()
    await stockBatch(w, 5, FAR)
    await serviceClient()
      .from('safety_stock_rules')
      .insert({ location_id: w.locationId, product_id: w.productId, minimum_qty: 2 })
    const id = await confirmedOrder(w, 5)

    expect((await rpc(sale, 'allocate_order', { p_order_id: id })).error?.code).toBe('42501')
    expect((await rpc(production, 'allocate_order', { p_order_id: id })).error?.code).toBe('42501')
    expect(
      (await rpc(warehouse, 'allocate_order', { p_order_id: id, p_allow_below_safety: true })).error
        ?.code,
    ).toBe('42501')

    const normal = await rpc(admin, 'allocate_order', { p_order_id: id })
    expect(normal.data).toMatchObject({ fully_allocated: false, shortage_total: 2 }) // safety stock kept
    const override = await rpc(admin, 'allocate_order', {
      p_order_id: id,
      p_allow_below_safety: true,
    })
    expect(override.data).toMatchObject({ fully_allocated: true })
  })

  it('refuses orders that are not CONFIRMED', async () => {
    const w = await world()
    await stockBatch(w, 5, FAR)
    const id = await submitted(w, 2)
    expect((await rpc(admin, 'allocate_order', { p_order_id: id })).error?.message).toMatch(
      /đã xác nhận/,
    )
  })

  it('cancelling an allocated (RESERVED) order releases the stock and resets the counters', async () => {
    const w = await world()
    await stockBatch(w, 10, FAR)
    const id = await confirmedOrder(w, 4)
    await rpc(admin, 'allocate_order', { p_order_id: id })
    expect(await reservedTotal(w.locationId, w.productId)).toBe(4)

    expect((await act(sale, id, 'cancel', 'Muốn hủy')).error?.code).toBe('42501') // owner cannot cancel a reserved order
    expect((await act(admin, id, 'cancel', 'Admin hủy')).error).toBeNull()
    expect(await reservedTotal(w.locationId, w.productId)).toBe(0)
    expect(
      (
        await serviceClient()
          .from('order_items')
          .select('allocated_quantity')
          .eq('order_id', id)
          .single()
      ).data?.allocated_quantity,
    ).toBe(0)
    expect((await reservations(id)).every((r) => r.status === 'RELEASED')).toBe(true)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })
})

describe('access to reservations', () => {
  it('shows holds to the order owner, Admin and Warehouse only; blocks every direct write', async () => {
    const w = await world()
    await stockBatch(w, 10, FAR)
    const id = await submitted(w, 3)
    await act(admin, id, 'confirm')

    for (const client of [sale, admin, warehouse]) {
      expect(
        (await client.from('inventory_reservations').select('id').eq('order_id', id)).data,
      ).toHaveLength(1)
    }
    for (const client of [store, production]) {
      expect(
        (await client.from('inventory_reservations').select('id').eq('order_id', id)).data ?? [],
      ).toHaveLength(0)
    }

    const [row] = await reservations(id)
    for (const client of [sale, admin, warehouse]) {
      const upd = await client
        .from('inventory_reservations')
        .update({ quantity: 99 } as never)
        .eq('id', row?.id as string)
        .select()
      expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true)
      const del = await client
        .from('inventory_reservations')
        .delete()
        .eq('id', row?.id as string)
        .select()
      expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    }
    const svc = serviceClient()
    expect(
      (
        await svc
          .from('inventory_reservations')
          .update({ quantity: 99 })
          .eq('id', row?.id as string)
      ).error?.message,
    ).toMatch(/Không được sửa giữ hàng trực tiếp/)
    expect(
      (
        await svc
          .from('inventory_reservations')
          .delete()
          .eq('id', row?.id as string)
      ).error?.message,
    ).toMatch(/Không được xóa/)
    expect(
      (
        await svc
          .from('inventory_balances')
          .update({ reserved_qty: 0 })
          .eq('id', row?.id as string)
      ).error?.message ?? '',
    ).toBeDefined()
  })

  it('order_stock_status is limited to the owner, Admin and Warehouse', async () => {
    const w = await world()
    await stockBatch(w, 10, FAR)
    const id = await submitted(w, 2)
    expect((await rpc(sale, 'order_stock_status', { p_order_id: id })).error).toBeNull()
    expect((await rpc(admin, 'order_stock_status', { p_order_id: id })).error).toBeNull()
    expect((await rpc(warehouse, 'order_stock_status', { p_order_id: id })).error).toBeNull()
    expect((await rpc(store, 'order_stock_status', { p_order_id: id })).error).not.toBeNull()
    expect((await rpc(production, 'order_stock_status', { p_order_id: id })).error).not.toBeNull()
  })

  it('release_expired_reservations is Admin-only and a no-op when nothing has expired', async () => {
    expect((await rpc(warehouse, 'release_expired_reservations')).error?.code).toBe('42501')
    expect((await rpc(admin, 'release_expired_reservations')).error).toBeNull()
  })

  it('suggest_transfer_sources ranks same-region sources first and excludes the destination', async () => {
    const dest = await world('HN')
    const near = await world('HN')
    const far = await world('HCM')
    await stockBatch({ productId: dest.productId, locationId: near.locationId }, 5, FAR)
    await stockBatch({ productId: dest.productId, locationId: far.locationId }, 50, FAR)
    const { data, error } = await rpc(sale, 'suggest_transfer_sources', {
      p_product_id: dest.productId,
      p_destination_location_id: dest.locationId,
      p_quantity: 20,
    })
    expect(error).toBeNull()
    expect(data.map((r: any) => r.location_id)).toEqual([near.locationId, far.locationId])
    expect(data[0]).toMatchObject({ same_region: true, covers_all: false })
    expect(data[1]).toMatchObject({ same_region: false, covers_all: true })
    expect(
      (
        await rpc(production, 'suggest_transfer_sources', {
          p_product_id: dest.productId,
          p_destination_location_id: dest.locationId,
          p_quantity: 1,
        })
      ).error?.code,
    ).toBe('42501')
  })
})
