/* eslint-disable @typescript-eslint/no-explicit-any -- RPC results are dynamic JSON; the tests assert on their shape */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AppSupabaseClient } from '@/lib/supabase'
import type { Database } from '@/types/database.generated'
import { TEST_PASSWORD, TEST_USERS, getLocalConfig, serviceClient } from './helpers'

/**
 * RES-005: the configurable allocation lead time drives automatic physical allocation by delivery date.
 * Semantics (pgTAP covers the date arithmetic in depth): due = scheduled_date - lead <= business day;
 * only the due delivery's own quantity is reserved, at its own source, FEFO, safety stock respected;
 * the job and the manual RPC never double-reserve; permissions of the manual RPC are unchanged.
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
let anon: AppSupabaseClient
let customer: string
const svc = () => serviceClient()

beforeAll(async () => {
  ;[admin, sale, store, warehouse] = await Promise.all([
    clientFor(TEST_USERS.admin),
    clientFor(TEST_USERS.sale),
    clientFor(TEST_USERS.store),
    clientFor(TEST_USERS.warehouse),
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
const runJob = (client: AppSupabaseClient) => rpc(client, 'run_due_delivery_allocation')
const allocate = (client: AppSupabaseClient, id: string, belowSafety = false) =>
  rpc(client, 'allocate_delivery_stock', { p_delivery_id: id, p_allow_below_safety: belowSafety })

/** Calendar date in Vietnam, `offset` days from now (the business day the job uses). */
function vnDate(offset = 0) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offset * 86400000))
}

/** Runs `fn` with allocation_lead_days changed (or removed), always restoring the original. */
async function withLead(value: number | null, fn: () => Promise<void>) {
  const { data: before } = await svc()
    .from('app_settings')
    .select('value')
    .eq('key', 'allocation_lead_days')
    .maybeSingle()
  try {
    if (value === null) await svc().from('app_settings').delete().eq('key', 'allocation_lead_days')
    else
      await svc()
        .from('app_settings')
        .upsert({ key: 'allocation_lead_days', value: value as never }, { onConflict: 'key' })
    await fn()
  } finally {
    if (before) {
      await svc()
        .from('app_settings')
        .upsert(
          { key: 'allocation_lead_days', value: before.value as never },
          { onConflict: 'key' },
        )
    }
  }
}

interface World {
  productId: string
  x: string
}

/** One product with `qty` units (FEFO batch) at one source location. */
async function world(qty: number): Promise<World> {
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data: product } = await svc()
    .from('products')
    .insert({
      sku: `P-AA-${tag}`,
      name: `Bánh tự phân bổ ${tag}`,
      list_price: 100000,
      default_commission_rate: 0,
    })
    .select('id')
    .single()
  const { data: loc } = await svc()
    .from('locations')
    .insert({ code: `AA-${tag}`, name: `Kho AA ${tag}`, location_type: 'STORE', region: 'HN' })
    .select('id')
    .single()
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
  return { productId: product?.id as string, x: loc?.id as string }
}

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

const planOn = (order: Order, qty: number, source: string, date: string) =>
  rpc(sale, 'save_delivery', {
    p_delivery_id: null,
    p_order_id: order.id,
    p_scheduled_date: date,
    p_items: [{ order_item_id: order.itemId, quantity: qty }],
    p_delivery_address: '12 Phố Huế, Hà Nội',
    p_source_location_id: source,
  })

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

const orderStatus = async (id: string) =>
  (await svc().from('orders').select('status').eq('id', id).single()).data?.status as string

const outcome = (job: any, deliveryId: string) =>
  (job.deliveries ?? []).find((d: any) => d.delivery_id === deliveryId)?.outcome as
    string | undefined

describe('automatic allocation by delivery date (RES-005)', () => {
  it('lets only Admin run the job', async () => {
    for (const client of [sale, store, warehouse]) {
      expect((await runJob(client)).error?.code).toBe('42501')
    }
    expect((await runJob(anon)).error).not.toBeNull()
    await withLead(0, async () => {
      const res = await runJob(admin)
      expect(res.error).toBeNull()
      expect(res.data).toMatchObject({ status: 'done', lead_days: 0 })
    })
  })

  it('allocates the due delivery only, leaves a later sibling as demand, and is idempotent', async () => {
    const w = await world(20)
    const order = await confirmedOrder(w, 10)
    const due = (await planOn(order, 4, w.x, vnDate(0))).data
    const later = (await planOn(order, 6, w.x, vnDate(30))).data

    await withLead(0, async () => {
      const first = await runJob(admin)
      expect(first.error).toBeNull()
      expect(outcome(first.data, due.id)).toBe('allocated')
      expect(outcome(first.data, later.id)).toBeUndefined()
      expect(await reservedAt(order.itemId, w.x)).toBe(4)
      expect(
        (
          await svc()
            .from('order_items')
            .select('allocated_quantity')
            .eq('id', order.itemId)
            .single()
        ).data?.allocated_quantity,
      ).toBe(4)

      const again = await runJob(admin)
      expect(outcome(again.data, due.id)).toBe('already_covered')
      expect(await reservedAt(order.itemId, w.x)).toBe(4)
    })

    // with a long lead time the sibling becomes due too: it gets its own 6, never the whole order twice
    await withLead(60, async () => {
      const res = await runJob(admin)
      expect(outcome(res.data, later.id)).toBe('allocated')
      expect(await reservedAt(order.itemId, w.x)).toBe(10)
    })
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])

    const { data: logs } = await svc()
      .from('audit_logs')
      .select('actor_user_id, reason')
      .eq('entity_type', 'deliveries')
      .eq('entity_id', due.id)
      .eq('action', 'allocate_stock')
    expect(logs?.length).toBe(1)
    expect(logs?.[0]?.actor_user_id).toBeNull()
    expect(logs?.[0]?.reason).toContain('Tự động')
  })

  it('does nothing for a delivery that is not due yet', async () => {
    const w = await world(10)
    const order = await confirmedOrder(w, 5)
    const far = (await planOn(order, 5, w.x, vnDate(20))).data
    await withLead(3, async () => {
      const res = await runJob(admin)
      expect(outcome(res.data, far.id)).toBeUndefined()
      expect(await reservedAt(order.itemId, w.x)).toBe(0)
      expect(await orderStatus(order.id)).toBe('CONFIRMED')
    })
  })

  it('reports a shortage without reserving and stores the evidence once', async () => {
    const w = await world(3)
    const order = await confirmedOrder(w, 5)
    const d = (await planOn(order, 5, w.x, vnDate(0))).data
    await withLead(0, async () => {
      const first = await runJob(admin)
      expect(outcome(first.data, d.id)).toBe('shortage')
      expect(await reservedAt(order.itemId, w.x)).toBe(0)
      await runJob(admin)
      const { data: rows } = await svc()
        .from('audit_logs')
        .select('after_data, actor_user_id')
        .eq('entity_type', 'deliveries')
        .eq('entity_id', d.id)
        .eq('action', 'auto_allocate_shortage')
      expect(rows?.length).toBe(1)
      expect((rows?.[0]?.after_data as any).shortage_total).toBe(2)
      expect(rows?.[0]?.actor_user_id).toBeNull()
    })
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('fails with a clear message when the lead time is not configured', async () => {
    await withLead(null, async () => {
      const res = await runJob(admin)
      expect(res.error?.code).toBe('P0001')
      expect(res.error?.message).toMatch(/Cấu hình hệ thống/)
    })
  })

  it('never double-reserves when two runs, or a run and the manual RPC, race', async () => {
    const w = await world(20)
    const order = await confirmedOrder(w, 5)
    const d = (await planOn(order, 5, w.x, vnDate(0))).data
    await withLead(0, async () => {
      const [a, b] = await Promise.all([runJob(admin), runJob(admin)])
      expect(a.error).toBeNull()
      expect(b.error).toBeNull()
      expect(await reservedAt(order.itemId, w.x)).toBe(5)
    })

    const w2 = await world(20)
    const order2 = await confirmedOrder(w2, 5)
    const d2 = (await planOn(order2, 5, w2.x, vnDate(0))).data
    await withLead(0, async () => {
      const [job, manual] = await Promise.all([runJob(admin), allocate(warehouse, d2.id)])
      expect(job.error).toBeNull()
      expect(manual.error).toBeNull()
      expect(await reservedAt(order2.itemId, w2.x)).toBe(5)
    })
    expect(d.id).not.toBe(d2.id)
    expect((await rpc(admin, 'verify_inventory_balances')).data).toEqual([])
  })

  it('keeps the manual RPC exactly as before: no lead-time guard, same authorization', async () => {
    const w = await world(10)
    const order = await confirmedOrder(w, 5)
    const far = (await planOn(order, 5, w.x, vnDate(40))).data
    await withLead(0, async () => {
      for (const client of [sale, store]) {
        expect((await allocate(client, far.id)).error?.code).toBe('42501')
      }
      expect((await allocate(warehouse, far.id, true)).error?.code).toBe('42501')
      expect(await reservedAt(order.itemId, w.x)).toBe(0)
      // staff can still allocate a delivery that is not due: the explicit override
      const res = await allocate(warehouse, far.id)
      expect(res.error).toBeNull()
      expect(res.data).toMatchObject({ fully_allocated: true, allocated_total: 5 })
      expect(await reservedAt(order.itemId, w.x)).toBe(5)
    })
  })
})
