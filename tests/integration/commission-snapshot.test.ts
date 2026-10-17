/* eslint-disable @typescript-eslint/no-explicit-any -- RPC results are dynamic JSON; the tests assert on their shape */
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commissionBreakdown } from '@/domain/orders/commission'
import type { AppSupabaseClient } from '@/lib/supabase'
import { createOrderService } from '@/services/orders.service'
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

// Talk to the snapshot table loosely: the tests probe what a client may and may not do with it.
const snapshotTable = (client: AppSupabaseClient) =>
  (client as unknown as SupabaseClient).from('order_item_commission_snapshots')

let admin: AppSupabaseClient
let sale: AppSupabaseClient
let store: AppSupabaseClient
let warehouse: AppSupabaseClient
let customer: string
let saleId: string
const ruleIds: string[] = []

const svc = () => serviceClient()

beforeAll(async () => {
  ;[admin, sale, store, warehouse] = await Promise.all([
    clientFor(TEST_USERS.admin),
    clientFor(TEST_USERS.sale),
    clientFor(TEST_USERS.store),
    clientFor(TEST_USERS.warehouse),
  ])
  const { data: cust } = await svc()
    .from('customers')
    .select('id')
    .eq('phone_normalized', '0900000003')
    .single()
  customer = cust?.id as string
  const { data: profile } = await svc()
    .from('profiles')
    .select('id')
    .eq('full_name', 'Sale B2B Test')
    .single()
  saleId = profile?.id as string
})

// The rules created here target throw-away products only, but switch them off anyway.
afterAll(async () => {
  if (ruleIds.length > 0) {
    await svc().from('commission_rules').update({ is_active: false }).in('id', ruleIds)
  }
})

/** Runs `fn` with the deposit policy temporarily changed, always restoring the originals. */
async function withDeposit(type: string, value: number, fn: () => Promise<void>) {
  const keys = ['default_deposit_type', 'default_deposit_value']
  const { data: before } = await svc().from('app_settings').select('key, value').in('key', keys)
  const restore = Object.fromEntries((before ?? []).map((r) => [r.key, r.value]))
  const write = (key: string, v: unknown) =>
    svc()
      .from('app_settings')
      .upsert({ key, value: v as never }, { onConflict: 'key' })
  try {
    await write('default_deposit_type', type)
    await write('default_deposit_value', value)
    await fn()
  } finally {
    for (const key of keys) await write(key, restore[key])
  }
}

interface Fixture {
  id: string
  sku: string
  price: number
  ruleId: string
}

/** A fresh product plus a user+product rule for the Sale B2B seller (priority 1, so it beats seed rules). */
async function product(price: number, ratePercent: number): Promise<Fixture> {
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data: p, error } = await svc()
    .from('products')
    .insert({
      sku: `P-CS-${tag}`,
      name: `Sản phẩm hoa hồng ${tag}`,
      list_price: price,
      default_commission_rate: 0,
    })
    .select('id, sku')
    .single()
  expect(error).toBeNull()
  const { data: rule } = await svc()
    .from('commission_rules')
    .insert({
      user_id: saleId,
      product_id: p?.id,
      rate_percent: ratePercent,
      effective_from: '2000-01-01',
    })
    .select('id')
    .single()
  ruleIds.push(rule?.id as string)
  return { id: p?.id as string, sku: p?.sku as string, price, ruleId: rule?.id as string }
}

async function setRate(fixture: Fixture, ratePercent: number) {
  const { error } = await svc()
    .from('commission_rules')
    .update({ rate_percent: ratePercent })
    .eq('id', fixture.ruleId)
  expect(error).toBeNull()
}

interface Line {
  p: Fixture
  qty: number
}

const toItems = (lines: Line[]) => lines.map((l) => ({ product_id: l.p.id, quantity: l.qty }))

async function draft(lines: Line[], discount = 0) {
  const { data, error } = await rpc(sale, 'save_draft_order', {
    p_order_id: null,
    p_customer_id: customer,
    p_items: toItems(lines),
    p_discount_amount: discount,
  })
  expect(error).toBeNull()
  return data as { id: string; net_amount: number }
}

const act = (client: AppSupabaseClient, id: string, action: string, reason: string | null = null) =>
  rpc(client, 'transition_order', { p_order_id: id, p_action: action, p_reason: reason })

/** Submitted by the seller, confirmed by the Admin -> WAITING_DEPOSIT (seed policy: 30% deposit). */
async function waitingDeposit(orderId: string): Promise<number> {
  expect((await act(sale, orderId, 'submit')).error).toBeNull()
  const confirmed = await act(admin, orderId, 'confirm')
  expect(confirmed.error).toBeNull()
  expect(confirmed.data.status).toBe('WAITING_DEPOSIT')
  return confirmed.data.deposit_required as number
}

async function payDeposit(orderId: string, amount: number) {
  const { error } = await rpc(admin, 'record_payment', {
    p_order_id: orderId,
    p_method: 'CASH',
    p_amount: amount,
  })
  expect(error).toBeNull()
}

const status = async (orderId: string) =>
  (await svc().from('orders').select('status').eq('id', orderId).single()).data?.status

/** Snapshot rows of an order with the SKU attached, in the order the database reports lines (SKU, byte order). */
async function snapshotRows(orderId: string) {
  const { data, error } = await svc()
    .from('order_item_commission_snapshots')
    .select('*')
    .eq('order_id', orderId)
  expect(error).toBeNull()
  const rows = data ?? []
  if (rows.length === 0) return []
  const { data: skus } = await svc()
    .from('products')
    .select('id, sku')
    .in(
      'id',
      rows.map((r) => r.product_id),
    )
  const skuOf = new Map((skus ?? []).map((s) => [s.id, s.sku as string] as const))
  return rows
    .map((r) => ({ ...r, sku: skuOf.get(r.product_id) as string }))
    .sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0))
}

async function estimate(client: AppSupabaseClient, orderId: string) {
  const { data, error } = await rpc(client, 'estimate_order_commission', { p_order_id: orderId })
  expect(error).toBeNull()
  return data
}

describe('estimated commission (COM-002)', () => {
  it('matches the TypeScript reference and the ORD-005 discount ceiling', async () => {
    const a = await product(33333, 7.5)
    const b = await product(10001, 12.34)
    const c = await product(6993, 0)
    const rates = new Map([
      [a.id, 7.5],
      [b.id, 12.34],
      [c.id, 0],
    ])
    const lines = [
      { p: a, qty: 1 },
      { p: b, qty: 3 },
      { p: c, qty: 1 },
    ]
    const order = await draft(lines, 5000)

    const { data: items } = await svc()
      .from('order_items')
      .select('id, product_id')
      .eq('order_id', order.id)
    const itemId = new Map((items ?? []).map((i) => [i.product_id, i.id as string] as const))
    const expected = commissionBreakdown(
      lines.map((l) => ({
        id: itemId.get(l.p.id) as string,
        sku: l.p.sku,
        grossLineAmount: l.p.price * l.qty,
        ratePercent: rates.get(l.p.id) as number,
      })),
      5000,
    )

    const est = await estimate(sale, order.id)
    expect(est).toMatchObject({
      basis: 'ESTIMATE',
      is_final: false,
      seller_user_id: saleId,
      gross_amount: 70329,
      discount_amount: 5000,
      base_commission: expected.baseCommission,
      final_commission: expected.finalCommission,
      discount_within_base_commission: true,
    })
    const dbLines = est.lines.map((l: any) => ({
      sku: l.sku,
      base: l.base_commission,
      share: l.customer_discount_share,
      final: l.final_commission,
    }))
    const tsLines = expected.lines.map((l) => ({
      sku: l.sku,
      base: l.baseCommission,
      share: l.customerDiscountShare,
      final: l.finalCommission,
    }))
    expect(dbLines).toEqual(tsLines)

    // base commission is exactly the ceiling the quote used for the discount check (ORD-005)
    const quote = await rpc(sale, 'quote_order', { p_items: toItems(lines) })
    expect(quote.data.max_discount_amount).toBe(est.base_commission)
  })

  it('stays an estimate through submit and the Admin confirmation, and follows rule changes', async () => {
    const p = await product(100000, 10)
    const order = await draft([{ p, qty: 5 }]) // gross 500.000, 10% -> 50.000
    expect((await estimate(sale, order.id)).base_commission).toBe(50000)

    const deposit = await waitingDeposit(order.id)
    expect(deposit).toBeGreaterThan(0)
    expect(await snapshotRows(order.id)).toHaveLength(0)

    await setRate(p, 12)
    const moved = await estimate(sale, order.id)
    expect(moved.basis).toBe('ESTIMATE')
    expect(moved.base_commission).toBe(60000)
    expect(await snapshotRows(order.id)).toHaveLength(0)
  })

  it('snapshots rate, rule evidence and seller when the deposit makes the order CONFIRMED', async () => {
    const p = await product(100000, 10)
    const order = await draft([{ p, qty: 5 }])
    const deposit = await waitingDeposit(order.id)

    await setRate(p, 12) // changed while the order waits for its deposit: this is the rate that gets frozen
    await payDeposit(order.id, deposit)
    expect(await status(order.id)).toBe('CONFIRMED')

    const rows = await snapshotRows(order.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      order_id: order.id,
      product_id: p.id,
      seller_user_id: saleId,
      seller_role_code: 'SALE_B2B',
      quantity: 5,
      commission_revenue: 500000,
      rate_percent: 12,
      rule_source: 'USER_PRODUCT',
      rule_id: p.ruleId,
      rule_effective_from: '2000-01-01',
      rule_effective_to: null,
      base_commission: 60000,
      customer_discount_share: 0,
      final_commission: 60000,
    })

    // Later rule changes (edit, a newer overriding rule, deactivation) never rewrite the order.
    await setRate(p, 20)
    const newer = await svc()
      .from('commission_rules')
      .insert({
        user_id: saleId,
        product_id: p.id,
        rate_percent: 30,
        effective_from: '2000-01-02',
      })
      .select('id')
      .single()
    ruleIds.push(newer.data?.id as string)
    await svc().from('commission_rules').update({ is_active: false }).eq('id', p.ruleId)

    const after = await estimate(sale, order.id)
    expect(after).toMatchObject({ basis: 'SNAPSHOT', is_final: true, base_commission: 60000 })
    expect(after.lines[0]).toMatchObject({ rate_percent: 12, rule_source: 'USER_PRODUCT' })
    expect(await snapshotRows(order.id)).toEqual(rows)

    // a brand-new order meanwhile uses today's rules
    const fresh = await draft([{ p, qty: 5 }])
    expect((await estimate(sale, fresh.id)).lines[0]).toMatchObject({ rate_percent: 30 })
  })

  it('with a zero deposit the snapshot is taken at the Admin confirmation and survives a cancellation', async () => {
    await withDeposit('PERCENT', 0, async () => {
      const p = await product(50000, 8)
      const order = await draft([{ p, qty: 2 }]) // gross 100.000, 8% -> 8.000
      expect((await act(sale, order.id, 'submit')).error).toBeNull()
      expect(await snapshotRows(order.id)).toHaveLength(0)

      expect((await act(admin, order.id, 'confirm')).error).toBeNull()
      expect(await status(order.id)).toBe('CONFIRMED')
      const rows = await snapshotRows(order.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ rate_percent: 8, base_commission: 8000 })

      await setRate(p, 15)
      expect((await act(admin, order.id, 'cancel', 'Khách không nhận nữa')).error).toBeNull()
      expect(await status(order.id)).toBe('CANCELLED')
      expect(await snapshotRows(order.id)).toEqual(rows)
      expect((await estimate(sale, order.id)).basis).toBe('SNAPSHOT')
    })
  })

  it('does not snapshot an order that is cancelled before it was ever confirmed', async () => {
    const p = await product(50000, 8)
    const order = await draft([{ p, qty: 2 }])
    await waitingDeposit(order.id)
    expect((await act(admin, order.id, 'cancel', 'Khách không đặt nữa')).error).toBeNull()
    expect(await status(order.id)).toBe('CANCELLED')
    expect(await snapshotRows(order.id)).toHaveLength(0)
    expect((await estimate(sale, order.id)).basis).toBe('ESTIMATE')
  })
})

describe('commission permissions (COM-002)', () => {
  it('lets only the salesperson and the Admin read the estimate; the table itself is Admin-only', async () => {
    const p = await product(100000, 10)
    const order = await draft([{ p, qty: 1 }])

    expect((await estimate(sale, order.id)).basis).toBe('ESTIMATE')
    expect((await estimate(admin, order.id)).lines[0].rule_id).toBe(p.ruleId) // evidence: Admin only
    expect((await estimate(sale, order.id)).lines[0].rule_id).toBeNull()

    for (const outsider of [store, warehouse]) {
      const denied = await rpc(outsider, 'estimate_order_commission', { p_order_id: order.id })
      expect(denied.error?.code).toBe('42501')
    }
    // an unknown order answers exactly like a forbidden one: no existence leak
    const unknown = await rpc(store, 'estimate_order_commission', { p_order_id: randomUUID() })
    expect(unknown.error?.code).toBe('42501')

    await payDeposit(order.id, await waitingDeposit(order.id))

    // The table carries Admin-only rule evidence: the seller reads their figures through the RPC instead.
    const afterConfirm = await estimate(sale, order.id)
    expect(afterConfirm).toMatchObject({ basis: 'SNAPSHOT', is_final: true })
    expect(afterConfirm.lines[0].rule_id).toBeNull()
    expect((await estimate(admin, order.id)).lines[0].rule_id).toBe(p.ruleId)

    const adminRead = await snapshotTable(admin).select('order_id').eq('order_id', order.id)
    expect(adminRead.data).toHaveLength(1)
    for (const nonAdmin of [sale, store, warehouse]) {
      const seen = await snapshotTable(nonAdmin).select('order_id').eq('order_id', order.id)
      expect(seen.error).toBeNull()
      expect(seen.data).toEqual([])
    }
  })

  it('refuses every client write to the snapshot table, even for the Admin', async () => {
    const p = await product(100000, 10)
    const order = await draft([{ p, qty: 1 }])
    await payDeposit(order.id, await waitingDeposit(order.id))

    for (const client of [sale, admin]) {
      const update = await snapshotTable(client)
        .update({ rate_percent: 100 })
        .eq('order_id', order.id)
      expect(update.error?.code).toBe('42501')
      const del = await snapshotTable(client).delete().eq('order_id', order.id)
      expect(del.error?.code).toBe('42501')
      const insert = await snapshotTable(client).insert({ order_id: order.id })
      expect(insert.error?.code).toBe('42501')
    }
    expect((await snapshotRows(order.id))[0]).toMatchObject({ rate_percent: 10 })

    // not even the service role may rewrite or remove history
    const forced = await svc()
      .from('order_item_commission_snapshots')
      .update({ rate_percent: 100 })
      .eq('order_id', order.id)
    expect(forced.error).not.toBeNull()
    const purged = await svc()
      .from('order_item_commission_snapshots')
      .delete()
      .eq('order_id', order.id)
    expect(purged.error).not.toBeNull()
    expect(await snapshotRows(order.id)).toHaveLength(1)
  })

  it('refuses a service-role insert that would prefill a draft, and still snapshots the real rate', async () => {
    const p = await product(100000, 10)
    const order = await draft([{ p, qty: 5 }])
    const { data: item } = await svc()
      .from('order_items')
      .select('id, quantity, gross_line_amount')
      .eq('order_id', order.id)
      .single()
    const { data: role } = await svc().from('roles').select('id').eq('code', 'SALE_B2B').single()

    // A complete, constraint-valid row with a forged 99% rate: only the missing grant stops it.
    const forged = await svc().from('order_item_commission_snapshots').insert({
      order_id: order.id,
      order_item_id: item?.id,
      product_id: p.id,
      seller_user_id: saleId,
      seller_role_id: role?.id,
      seller_role_code: 'SALE_B2B',
      quantity: item?.quantity,
      commission_revenue: item?.gross_line_amount,
      rate_percent: 99,
      rule_source: 'NONE',
      resolved_on: '2026-10-16',
      base_commission: 1,
      customer_discount_share: 0,
    })
    expect(forged.error?.code).toBe('42501')
    expect(await snapshotRows(order.id)).toHaveLength(0)

    // The first confirmation, run by the trigger as the table owner, writes the real figures.
    await payDeposit(order.id, await waitingDeposit(order.id))
    const [row] = await snapshotRows(order.id)
    expect(row).toMatchObject({
      rate_percent: 10,
      rule_source: 'USER_PRODUCT',
      rule_id: p.ruleId,
      base_commission: 50000,
    })
  })
})

describe('order service (COM-002)', () => {
  it('returns the typed estimate to the seller and a permission error to anyone else', async () => {
    const p = await product(100000, 10)
    const order = await draft([{ p, qty: 2 }], 1000)

    const result = await createOrderService(sale).commissionEstimate(order.id)
    expect(result).toMatchObject({
      order_id: order.id,
      basis: 'ESTIMATE',
      is_final: false,
      base_commission: 20000,
      final_commission: 19000,
    })
    expect(result.lines).toHaveLength(1)

    await expect(createOrderService(store).commissionEstimate(order.id)).rejects.toMatchObject({
      code: '42501',
    })
  })
})
