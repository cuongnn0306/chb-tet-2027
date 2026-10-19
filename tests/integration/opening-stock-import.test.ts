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

beforeAll(async () => {
  ;[admin, warehouse] = await Promise.all([
    clientFor(TEST_USERS.admin),
    clientFor(TEST_USERS.warehouse),
  ])
})

const row = (over: Record<string, unknown> = {}) => ({
  location_code: 'HN-BEP',
  sku: 'DG-TUI',
  batch_code: `IMP-${randomUUID().slice(0, 8).toUpperCase()}`,
  manufactured_date: '2026-09-01',
  expiry_date: '2027-03-01',
  quantity: 10,
  ...over,
})

const run = (rows: unknown[], dryRun = true, client = admin) =>
  rpc(client, 'import_opening_stock', { p_rows: rows, p_dry_run: dryRun })

async function countBatches(code: string) {
  const { count } = await serviceClient()
    .from('product_batches')
    .select('*', { count: 'exact', head: true })
    .eq('batch_code', code)
  return count ?? 0
}

describe('opening stock import (INV-006)', () => {
  it('a dry run validates and reports totals without changing anything', async () => {
    const r = row()
    const { data, error } = await run([r, { ...r, location_code: 'HN-CH1', quantity: 5 }])
    expect(error).toBeNull()
    expect(data).toMatchObject({
      ok: true,
      dry_run: true,
      rows: 2,
      batches_to_create: 1,
      total_quantity: 15,
    })
    expect(await countBatches(r.batch_code)).toBe(0)
  })

  it('applies the file: creates the batch once, posts one ledger movement per row, balances match', async () => {
    const r = row({ quantity: 30 })
    const { data, error } = await run([r, { ...r, location_code: 'HN-CH1', quantity: 12 }], false)
    expect(error).toBeNull()
    expect(data).toMatchObject({
      ok: true,
      dry_run: false,
      rows: 2,
      batches_created: 1,
      total_quantity: 42,
    })
    expect(await countBatches(r.batch_code)).toBe(1)

    const svc = serviceClient()
    const { data: batch } = await svc
      .from('product_batches')
      .select('id, manufactured_date, expiry_date')
      .eq('batch_code', r.batch_code)
      .single()
    expect(batch).toMatchObject({ manufactured_date: '2026-09-01', expiry_date: '2027-03-01' })
    const { data: movements } = await svc
      .from('inventory_movements')
      .select('movement_type, quantity, reason')
      .eq('batch_id', batch?.id as string)
    expect(movements).toHaveLength(2)
    expect(
      movements?.every(
        (m) => m.movement_type === 'ADJUSTMENT_IN' && m.reason === 'Tồn đầu kỳ (import)',
      ),
    ).toBe(true)
    const { data: balances } = await svc
      .from('inventory_balances')
      .select('available_qty')
      .eq('batch_id', batch?.id as string)
    expect(balances?.map((b) => b.available_qty).sort()).toEqual([12, 30])

    const { data: mismatches } = await rpc(admin, 'verify_inventory_balances')
    expect(mismatches).toEqual([])
  })

  it('reuses an existing batch when the dates match, and adds the quantity', async () => {
    const r = row({ quantity: 4 })
    await run([r], false)
    const again = await run([{ ...r, quantity: 6 }], false)
    expect(again.data).toMatchObject({ ok: true, batches_created: 0, total_quantity: 6 })
    const { data: batch } = await serviceClient()
      .from('product_batches')
      .select('id')
      .eq('batch_code', r.batch_code)
      .single()
    const { data: bal } = await serviceClient()
      .from('inventory_balances')
      .select('available_qty')
      .eq('batch_id', batch?.id as string)
    expect(bal).toEqual([{ available_qty: 10 }])
  })

  it('is all-or-nothing: one bad row stops the whole file and nothing is written', async () => {
    const good = row()
    const bad = row({ sku: 'KHONG-CO' })
    const { data } = await run([good, bad], false)
    expect(data.ok).toBe(false)
    expect(data.errors).toEqual([{ row: 2, message: expect.stringMatching(/SKU "KHONG-CO"/) }])
    expect(await countBatches(good.batch_code)).toBe(0)
  })

  it('reports every problem with its row number, in Vietnamese', async () => {
    const { data } = await run([
      row({ location_code: 'NOPE' }),
      row({ sku: 'DG-NGUNG' }), // inactive product... DG-NGUNG is inactive in the seed
      row({ batch_code: '  ' }),
      row({ manufactured_date: '2026-02-30' }),
      row({ expiry_date: '2026-08-01' }),
      row({ quantity: 0 }),
      row({ quantity: 1.5 }),
      row({ quantity: '7' }),
    ])
    expect(data.ok).toBe(false)
    expect(data.error_count).toBe(8)
    const messages = data.errors.map((e: any) => `${e.row}: ${e.message}`)
    expect(messages[0]).toMatch(/^1: Mã địa điểm "NOPE"/)
    expect(messages[1]).toMatch(/^2: SKU "DG-NGUNG".*ngừng bán/)
    expect(messages[2]).toMatch(/^3: Thiếu mã lô/)
    expect(messages[3]).toMatch(/^4: Ngày sản xuất/)
    expect(messages[4]).toMatch(/^5: Hạn sử dụng phải sau/)
    expect(messages.slice(5).every((m: string) => /Số lượng phải là số nguyên/.test(m))).toBe(true)
  })

  it('rejects an existing batch with different dates, and inconsistent dates within the file', async () => {
    const r = row()
    await run([r], false)
    const conflict = await run([{ ...r, expiry_date: '2027-04-01' }])
    expect(conflict.data.errors[0].message).toMatch(/đã tồn tại với ngày khác/)

    const fresh = row()
    const mixed = await run([
      fresh,
      { ...fresh, location_code: 'HN-CH1', expiry_date: '2027-05-01' },
    ])
    expect(mixed.data.errors[0].message).toMatch(/nhiều lần với ngày khác nhau/)
  })

  it('refuses an empty file, a non-array and an oversized file', async () => {
    expect((await run([])).error?.message).toMatch(/không có dòng dữ liệu/)
    expect(
      (await rpc(admin, 'import_opening_stock', { p_rows: { a: 1 }, p_dry_run: true })).error
        ?.message,
    ).toMatch(/không có dòng dữ liệu/)
    const many = Array.from({ length: 5001 }, () => row())
    expect((await run(many)).error?.message).toMatch(/Tối đa 5000 dòng/)
  })

  it('caps the error list but still reports the true error count', async () => {
    const rows = Array.from({ length: 150 }, () => row({ quantity: 0 }))
    const { data } = await run(rows)
    expect(data.error_count).toBe(150)
    expect(data.errors).toHaveLength(100)
  })

  it('is Admin-only', async () => {
    const { error } = await run([row()], true, warehouse)
    expect(error?.code).toBe('42501')
    const { error: error2 } = await run([row()], false, await clientFor(TEST_USERS.sale))
    expect(error2?.code).toBe('42501')
  })
})
