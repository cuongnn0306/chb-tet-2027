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
let warehouse: AppSupabaseClient
let production: AppSupabaseClient
let sale: AppSupabaseClient
let inactive: AppSupabaseClient
let loc: { bep: string; ch1: string; ch2: string }
let product: string

beforeAll(async () => {
  ;[admin, warehouse, production, sale, inactive] = await Promise.all([
    clientFor(TEST_USERS.admin),
    clientFor(TEST_USERS.warehouse),
    clientFor(TEST_USERS.production),
    clientFor(TEST_USERS.sale),
    clientFor(TEST_USERS.inactive),
  ])
  const svc = serviceClient()
  const { data: locations } = await svc
    .from('locations')
    .select('id, code')
    .in('code', ['HN-BEP', 'HN-CH1', 'HN-CH2'])
  const by = Object.fromEntries((locations ?? []).map((l) => [l.code, l.id]))
  loc = { bep: by['HN-BEP'], ch1: by['HN-CH1'], ch2: by['HN-CH2'] }
  const { data: p } = await svc.from('products').select('id').eq('sku', 'COM-500').single()
  product = p?.id as string
})

/** A brand-new batch so a test owns its stock and reruns never interfere. */
async function newBatch(extra: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from('product_batches')
    .insert({
      batch_code: `T-${randomUUID().slice(0, 8)}`,
      product_id: product,
      manufactured_date: '2026-09-01',
      expiry_date: '2027-03-01',
      ...extra,
    })
    .select('id, batch_code')
    .single()
  expect(error).toBeNull()
  return data as { id: string; batch_code: string }
}

async function stock(batchId: string, qty: number, location = loc.bep) {
  const { error } = await rpc(admin, 'record_opening_stock', {
    p_location_id: location,
    p_product_id: product,
    p_batch_id: batchId,
    p_quantity: qty,
    p_note: 'test',
  })
  expect(error).toBeNull()
}

async function balance(batchId: string, location = loc.bep) {
  const { data } = await serviceClient()
    .from('inventory_balances')
    .select('*')
    .eq('batch_id', batchId)
    .eq('location_id', location)
    .maybeSingle()
  return data
}

const exit = (
  client: AppSupabaseClient,
  type: string,
  batchId: string,
  qty: number,
  reason = 'test',
  location = loc.bep,
) =>
  rpc(client, 'record_stock_exit', {
    p_type: type,
    p_location_id: location,
    p_product_id: product,
    p_batch_id: batchId,
    p_quantity: qty,
    p_reason: reason,
  })

describe('batches (INV-001)', () => {
  it('lets Admin and Warehouse create batches; unique per product + code; dates must be ordered', async () => {
    const code = `T-${randomUUID().slice(0, 8)}`
    const base = {
      batch_code: code,
      product_id: product,
      manufactured_date: '2026-09-01',
      expiry_date: '2027-03-01',
    }
    expect((await warehouse.from('product_batches').insert(base)).error).toBeNull()
    expect((await admin.from('product_batches').insert(base)).error?.code).toBe('23505')
    expect(
      (
        await admin
          .from('product_batches')
          .insert({ ...base, batch_code: `${code}X`, expiry_date: '2026-08-01' })
      ).error?.code,
    ).toBe('23514')
    expect(
      (await admin.from('product_batches').insert({ ...base, batch_code: '  ' })).error?.code,
    ).toBe('23514')
  })

  it('hides batches from sales and inactive users, and refuses their writes', async () => {
    const batch = await newBatch()
    for (const client of [sale, inactive]) {
      expect(
        (await client.from('product_batches').select('id').eq('id', batch.id)).data ?? [],
      ).toHaveLength(0)
      const { error } = await client.from('product_batches').insert({
        batch_code: 'X',
        product_id: product,
        manufactured_date: '2026-09-01',
        expiry_date: '2027-03-01',
      })
      expect(error).not.toBeNull()
    }
    expect(
      (await production.from('product_batches').select('id').eq('id', batch.id)).data,
    ).toHaveLength(1)
  })

  it('freezes identity and dates once stock moved, and can never be deleted', async () => {
    const batch = await newBatch()
    expect(
      (await admin.from('product_batches').update({ expiry_date: '2027-04-01' }).eq('id', batch.id))
        .error,
    ).toBeNull() // no movement yet
    await stock(batch.id, 5)
    const changed = await admin
      .from('product_batches')
      .update({ expiry_date: '2027-05-01' })
      .eq('id', batch.id)
    expect(changed.error?.message).toMatch(/không được sửa/)
    expect(
      (await admin.from('product_batches').update({ status: 'INACTIVE' }).eq('id', batch.id)).error,
    ).toBeNull() // status is still editable
    expect(
      (await serviceClient().from('product_batches').delete().eq('id', batch.id)).error?.message,
    ).toMatch(/Không được xóa lô hàng/)
    const nonAdmin = await warehouse
      .from('product_batches')
      .update({ status: 'ACTIVE' })
      .eq('id', batch.id)
      .select()
    expect(nonAdmin.error !== null || (nonAdmin.data ?? []).length === 0).toBe(true)
  })
})

describe('opening stock and adjustments (INV-005, INV-010)', () => {
  it('records opening stock as a ledger movement and updates the cache', async () => {
    const batch = await newBatch()
    await stock(batch.id, 40)
    expect((await balance(batch.id))?.available_qty).toBe(40)
    const { data: movements } = await serviceClient()
      .from('inventory_movements')
      .select('*')
      .eq('batch_id', batch.id)
    expect(movements).toHaveLength(1)
    expect(movements?.[0]).toMatchObject({
      movement_type: 'ADJUSTMENT_IN',
      quantity: 40,
      to_location_id: loc.bep,
    })
    expect(movements?.[0]?.reason).toMatch(/^Tồn đầu kỳ/)
    expect(movements?.[0]?.created_by).not.toBeNull()
  })

  it('is Admin-only', async () => {
    const batch = await newBatch()
    for (const client of [warehouse, production, sale, inactive]) {
      const { error } = await rpc(client, 'record_opening_stock', {
        p_location_id: loc.bep,
        p_product_id: product,
        p_batch_id: batch.id,
        p_quantity: 5,
      })
      expect(error?.code, 'non-admin').toBe('42501')
    }
    expect(await balance(batch.id)).toBeNull()
  })

  it('adjusts in and out with a mandatory reason, and never below zero', async () => {
    const batch = await newBatch()
    await stock(batch.id, 10)
    const adjust = (direction: string, qty: number, reason: string | null) =>
      rpc(admin, 'adjust_inventory', {
        p_direction: direction,
        p_location_id: loc.bep,
        p_product_id: product,
        p_batch_id: batch.id,
        p_quantity: qty,
        p_reason: reason,
      })
    expect((await adjust('OUT', 3, null)).error?.message).toMatch(/lý do/)
    expect((await adjust('OUT', 3, '   ')).error?.message).toMatch(/lý do/)
    expect((await adjust('OUT', 3, 'Kiểm kê thiếu 3')).error).toBeNull()
    expect((await adjust('IN', 5, 'Kiểm kê dư 5')).error).toBeNull()
    expect((await balance(batch.id))?.available_qty).toBe(12)

    const tooMuch = await adjust('OUT', 13, 'Quá tay')
    expect(tooMuch.error?.message).toMatch(/Không đủ hàng khả dụng/)
    expect((await balance(batch.id))?.available_qty).toBe(12)
    expect((await adjust('OUT', 12, 'Xuất hết')).error).toBeNull()
    expect((await balance(batch.id))?.available_qty).toBe(0)
    expect((await adjust('SIDEWAYS', 1, 'x')).error).not.toBeNull()
  })

  it('is Admin-only', async () => {
    const batch = await newBatch()
    await stock(batch.id, 10)
    for (const client of [warehouse, sale]) {
      const { error } = await rpc(client, 'adjust_inventory', {
        p_direction: 'OUT',
        p_location_id: loc.bep,
        p_product_id: product,
        p_batch_id: batch.id,
        p_quantity: 1,
        p_reason: 'x',
      })
      expect(error?.code).toBe('42501')
    }
    expect((await balance(batch.id))?.available_qty).toBe(10)
  })
})

describe('sample / gift / damage exits (INV-011)', () => {
  it('tracks each kind on its own counter with a reason, for Admin and Warehouse', async () => {
    const batch = await newBatch()
    await stock(batch.id, 30)
    expect(
      (await exit(warehouse, 'SAMPLE_OUT', batch.id, 2, 'Hàng mẫu cho khách')).error,
    ).toBeNull()
    expect((await exit(admin, 'GIFT_OUT', batch.id, 3, 'Biếu đối tác')).error).toBeNull()
    expect((await exit(warehouse, 'DAMAGE_OUT', batch.id, 4, 'Vỡ khi vận chuyển')).error).toBeNull()
    expect(await balance(batch.id)).toMatchObject({
      available_qty: 21,
      sample_qty: 2,
      gift_qty: 3,
      damaged_qty: 4,
    })
  })

  it('requires a reason, restricts the type, and refuses to over-take', async () => {
    const batch = await newBatch()
    await stock(batch.id, 5)
    expect((await exit(warehouse, 'DAMAGE_OUT', batch.id, 1, '')).error?.message).toMatch(/lý do/)
    expect((await exit(warehouse, 'SALE_OUT', batch.id, 1, 'x')).error?.message).toMatch(
      /không hợp lệ/,
    )
    expect((await exit(warehouse, 'DAMAGE_OUT', batch.id, 6, 'x')).error?.message).toMatch(
      /Không đủ hàng khả dụng/,
    )
    expect((await balance(batch.id))?.available_qty).toBe(5)
  })

  it('is denied to sales, production and inactive users', async () => {
    const batch = await newBatch()
    await stock(batch.id, 5)
    for (const client of [sale, production, inactive]) {
      expect((await exit(client, 'DAMAGE_OUT', batch.id, 1, 'x')).error?.code).toBe('42501')
    }
    expect((await balance(batch.id))?.available_qty).toBe(5)
  })
})

describe('no negative inventory under concurrency (non-negotiable)', () => {
  it('two processes taking the last unit: exactly one wins, the other gets a clear error', async () => {
    const batch = await newBatch()
    await stock(batch.id, 1)
    const [a, b] = await Promise.all([
      exit(admin, 'DAMAGE_OUT', batch.id, 1, 'đua tranh A'),
      exit(warehouse, 'DAMAGE_OUT', batch.id, 1, 'đua tranh B'),
    ])
    const outcomes = [a, b]
    expect(outcomes.filter((o) => o.error === null)).toHaveLength(1)
    const loser = outcomes.find((o) => o.error !== null)
    expect(loser?.error?.message).toMatch(/Không đủ hàng khả dụng/)
    expect(await balance(batch.id)).toMatchObject({ available_qty: 0, damaged_qty: 1 })
    const { data: movements } = await serviceClient()
      .from('inventory_movements')
      .select('movement_type')
      .eq('batch_id', batch.id)
    expect(movements).toHaveLength(2) // the opening stock + exactly one exit
  })

  it('many concurrent takers never oversell: 3 units, 12 attempts => 3 successes', async () => {
    const batch = await newBatch()
    await stock(batch.id, 3)
    const clients = [admin, warehouse]
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        exit(clients[i % 2] as AppSupabaseClient, 'SAMPLE_OUT', batch.id, 1, `thử ${i}`),
      ),
    )
    expect(results.filter((r) => r.error === null)).toHaveLength(3)
    expect(
      results.filter((r) => r.error !== null).every((r) => /Không đủ hàng/.test(r.error.message)),
    ).toBe(true)
    expect(await balance(batch.id)).toMatchObject({ available_qty: 0, sample_qty: 3 })
  })

  it('keeps ledger and cache equal after all of that', async () => {
    const { data, error } = await rpc(admin, 'verify_inventory_balances')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

describe('direct writes are impossible (ledger is the source of truth)', () => {
  it('blocks clients from writing balances or movements', async () => {
    const batch = await newBatch()
    await stock(batch.id, 5)
    const row = await balance(batch.id)
    for (const client of [admin, warehouse, sale]) {
      const upd = await client
        .from('inventory_balances')
        .update({ available_qty: 9999 } as never)
        .eq('id', row?.id as string)
        .select()
      expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true)
      const ins = await client.from('inventory_movements').insert({
        movement_type: 'ADJUSTMENT_IN',
        product_id: product,
        batch_id: batch.id,
        to_location_id: loc.bep,
        quantity: 99,
        reason: 'x',
      } as never)
      expect(ins.error).not.toBeNull()
      const del = await client
        .from('inventory_balances')
        .delete()
        .eq('id', row?.id as string)
        .select()
      expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    }
    expect((await balance(batch.id))?.available_qty).toBe(5)
  })

  it('blocks even the service role outside the posting function', async () => {
    const batch = await newBatch()
    await stock(batch.id, 5)
    const svc = serviceClient()
    const row = await balance(batch.id)
    expect(
      (
        await svc
          .from('inventory_balances')
          .update({ available_qty: 9999 })
          .eq('id', row?.id as string)
      ).error?.message,
    ).toMatch(/Không được sửa tồn kho trực tiếp/)
    expect(
      (
        await svc
          .from('inventory_balances')
          .delete()
          .eq('id', row?.id as string)
      ).error?.message,
    ).toMatch(/Không được xóa/)
    expect(
      (
        await svc.from('inventory_movements').insert({
          movement_type: 'ADJUSTMENT_IN',
          product_id: product,
          batch_id: batch.id,
          to_location_id: loc.bep,
          quantity: 99,
          reason: 'x',
        })
      ).error?.message,
    ).toMatch(/Không được ghi trực tiếp vào sổ kho/)
    const { data: mv } = await svc
      .from('inventory_movements')
      .select('id')
      .eq('batch_id', batch.id)
      .limit(1)
      .single()
    expect(
      (
        await svc
          .from('inventory_movements')
          .update({ quantity: 1 })
          .eq('id', mv?.id as string)
      ).error?.message,
    ).toMatch(/bất biến/)
    expect(
      (
        await svc
          .from('inventory_movements')
          .delete()
          .eq('id', mv?.id as string)
      ).error?.message,
    ).toMatch(/bất biến/)
    expect((await balance(batch.id))?.available_qty).toBe(5)
  })
})

describe('who can read what', () => {
  it('shows balances to Admin/Warehouse/Production only, ledger to Admin/Warehouse only', async () => {
    const batch = await newBatch()
    await stock(batch.id, 7)
    for (const client of [admin, warehouse, production]) {
      expect(
        (await client.from('inventory_balances').select('id').eq('batch_id', batch.id)).data,
      ).toHaveLength(1)
    }
    for (const client of [sale, inactive]) {
      expect(
        (await client.from('inventory_balances').select('id').eq('batch_id', batch.id)).data ?? [],
      ).toHaveLength(0)
    }
    for (const client of [admin, warehouse]) {
      expect(
        (await client.from('inventory_movements').select('id').eq('batch_id', batch.id)).data,
      ).toHaveLength(1)
    }
    for (const client of [production, sale, inactive]) {
      expect(
        (await client.from('inventory_movements').select('id').eq('batch_id', batch.id)).data ?? [],
      ).toHaveLength(0)
    }
  })

  it('reconciliation is Admin-only', async () => {
    for (const client of [warehouse, sale, production]) {
      expect((await rpc(client, 'verify_inventory_balances')).error?.code).toBe('42501')
    }
  })
})

describe('inventory summary (INV-007)', () => {
  it('shows every active role the stock per location and SKU, with sellable after safety stock', async () => {
    // HN-CH1 x TT-1200 has safety stock 20 and 25 in the B-NEW seed batch => usable 25 - safety 20 = 5
    const svc = serviceClient()
    const { data: tt } = await svc.from('products').select('id').eq('sku', 'TT-1200').single()
    for (const client of [sale, warehouse, production, admin]) {
      const { data, error } = await rpc(client, 'inventory_summary', { p_location_id: loc.ch1 })
      expect(error).toBeNull()
      const row = data.find((r: any) => r.product_id === tt?.id)
      expect(row).toMatchObject({
        available_qty: 25,
        reserved_qty: 0,
        safety_stock_qty: 20,
        sellable_qty: 5,
      })
    }
  })

  it('never reports negative sellable stock when safety stock exceeds what is there', async () => {
    const svc = serviceClient()
    const { data: hq } = await svc.from('products').select('id').eq('sku', 'HQ-A').single()
    const { data: fr1 } = await svc.from('locations').select('id').eq('code', 'HCM-FR1').single()
    const { data } = await rpc(sale, 'inventory_summary', { p_location_id: fr1?.id })
    const row = data.find((r: any) => r.product_id === hq?.id)
    expect(row).toMatchObject({ available_qty: 6, safety_stock_qty: 5, sellable_qty: 1 })
  })

  it('excludes expired batches from sellable and reports them separately', async () => {
    const svc = serviceClient()
    const { data: tt500 } = await svc.from('products').select('id').eq('sku', 'TT-500').single()
    const { data } = await rpc(admin, 'inventory_summary', { p_location_id: loc.bep })
    const row = data.find((r: any) => r.product_id === tt500?.id)
    expect(row.expired_qty).toBe(10)
    expect(row.available_qty).toBe(60) // 50 usable + 10 expired
    expect(row.sellable_qty).toBe(50)
  })

  it('counts new stock into the summary and lists safety-stock rules that have no stock yet', async () => {
    const batch = await newBatch()
    const { data: before } = await rpc(sale, 'inventory_summary', { p_location_id: loc.ch2 })
    const was = before.find((r: any) => r.product_id === product)?.available_qty ?? 0
    await stock(batch.id, 11, loc.ch2)
    const { data: after } = await rpc(sale, 'inventory_summary', { p_location_id: loc.ch2 })
    expect(after.find((r: any) => r.product_id === product).available_qty).toBe(was + 11)
    // A safety-stock rule for a product with no stock anywhere is still listed, with sellable 0.
    const svc = serviceClient()
    const { data: noStock } = await svc.from('products').select('id').eq('sku', 'DG-TUI').single()
    await svc
      .from('safety_stock_rules')
      .upsert(
        { location_id: loc.ch1, product_id: noStock?.id as string, minimum_qty: 7 },
        { onConflict: 'location_id,product_id' },
      )
    const { data: listed } = await rpc(sale, 'inventory_summary', { p_location_id: loc.ch1 })
    expect(listed.find((r: any) => r.product_id === noStock?.id)).toMatchObject({
      available_qty: 0,
      safety_stock_qty: 7,
      sellable_qty: 0,
    })
  })

  it('does not count INACTIVE batches as sellable and is denied to inactive users', async () => {
    const batch = await newBatch()
    await stock(batch.id, 9, loc.ch1)
    const { data: live } = await rpc(sale, 'inventory_summary', { p_location_id: loc.ch1 })
    const before = live.find((r: any) => r.product_id === product)
    await admin.from('product_batches').update({ status: 'INACTIVE' }).eq('id', batch.id)
    const { data: off } = await rpc(sale, 'inventory_summary', { p_location_id: loc.ch1 })
    const after = off.find((r: any) => r.product_id === product)
    expect(after.available_qty).toBe(before.available_qty) // still physically there
    expect(before.sellable_qty - after.sellable_qty).toBe(9) // but no longer sellable
    expect((await rpc(inactive, 'inventory_summary')).error?.code).toBe('42501')
  })
})
