/* eslint-disable @typescript-eslint/no-explicit-any -- RPC results are dynamic JSON; the tests assert on their shape */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CustomerFields } from '@/domain/customers/validation'
import type { AppSupabaseClient } from '@/lib/supabase'
import { createCustomerService } from '@/services/customers.service'
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

const rpc = (client: AppSupabaseClient, fn: string, args: Record<string, unknown>) =>
  (
    client as unknown as {
      rpc: (f: string, a: unknown) => PromiseLike<{ data: any; error: any }>
    }
  ).rpc(fn, args)

let sale: AppSupabaseClient
let store: AppSupabaseClient
let admin: AppSupabaseClient
let warehouse: AppSupabaseClient
let hq: { id: string; price: number }
let tt: { id: string; price: number }

const fields = (): CustomerFields => ({
  customerType: 'INDIVIDUAL',
  name: `Khách lịch sử ${randomUUID().slice(0, 6)}`,
  phone: '',
  address: '',
  companyName: '',
  taxCode: '',
  contactName: '',
  contactTitle: '',
  email: '',
  companyAddress: '',
})

beforeAll(async () => {
  ;[sale, store, admin, warehouse] = await Promise.all([
    clientFor(TEST_USERS.sale),
    clientFor(TEST_USERS.store),
    clientFor(TEST_USERS.admin),
    clientFor(TEST_USERS.warehouse),
  ])
  const { data } = await serviceClient()
    .from('products')
    .select('id, sku, list_price')
    .in('sku', ['HQ-A', 'TT-800'])
  const by = Object.fromEntries((data ?? []).map((p) => [p.sku, { id: p.id, price: p.list_price }]))
  hq = by['HQ-A'] as typeof hq
  tt = by['TT-800'] as typeof tt
})

async function order(
  client: AppSupabaseClient,
  customerId: string,
  product: typeof hq,
  qty: number,
) {
  const { data, error } = await rpc(client, 'save_draft_order', {
    p_order_id: null,
    p_customer_id: customerId,
    p_items: [{ product_id: product.id, quantity: qty }],
    p_discount_amount: 0,
  })
  expect(error).toBeNull()
  return data.id as string
}

const act = (client: AppSupabaseClient, id: string, action: string, reason?: string) =>
  rpc(client, 'transition_order', { p_order_id: id, p_action: action, p_reason: reason ?? null })

describe('customer history (CUS-005)', () => {
  it('counts only real orders and sums their gross; drafts, cancelled and voided are excluded', async () => {
    const customer = await createCustomerService(sale).create(fields())

    // no orders yet
    expect(
      (await rpc(sale, 'customer_order_summary', { p_customer_ids: [customer.id] })).data,
    ).toEqual([])

    const draftOnly = await order(sale, customer.id, hq, 1)
    expect(
      (await rpc(sale, 'customer_order_summary', { p_customer_ids: [customer.id] })).data,
    ).toEqual([])

    const submitted1 = await order(sale, customer.id, hq, 2) // 2 x HQ-A
    await act(sale, submitted1, 'submit')
    const submitted2 = await order(store, customer.id, tt, 3) // a different user's order also counts
    await act(store, submitted2, 'submit')
    const cancelled = await order(sale, customer.id, tt, 9)
    await act(sale, cancelled, 'submit')
    await act(sale, cancelled, 'cancel', 'Khách đổi ý')
    const voided = await order(sale, customer.id, tt, 9)
    await act(admin, voided, 'void', 'Nhập nhầm')

    const { data, error } = await rpc(sale, 'customer_order_summary', {
      p_customer_ids: [customer.id],
    })
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].order_count).toBe(2)
    expect(data[0].total_gross).toBe(2 * hq.price + 3 * tt.price)
    expect(new Date(data[0].last_order_at).getTime()).toBeGreaterThan(Date.now() - 60_000)

    // the draft is untouched and still not counted
    const { data: row } = await serviceClient()
      .from('orders')
      .select('status')
      .eq('id', draftOnly)
      .single()
    expect(row?.status).toBe('DRAFT')
  })

  it('shows the same history to every order-creating role (not only the order owner)', async () => {
    const customer = await createCustomerService(sale).create(fields())
    const id = await order(sale, customer.id, hq, 1)
    await act(sale, id, 'submit')
    for (const client of [sale, store, admin]) {
      const { data } = await rpc(client, 'customer_order_summary', {
        p_customer_ids: [customer.id],
      })
      expect(data[0].order_count).toBe(1)
    }
    // ...while the store user still cannot see the order itself
    expect((await store.from('orders').select('id').eq('id', id)).data).toHaveLength(0)
  })

  it('returns an entry only for customers with orders, handles many ids and an empty list', async () => {
    const svc = createCustomerService(sale)
    const withOrder = await svc.create(fields())
    const without = await svc.create(fields())
    await act(sale, await order(sale, withOrder.id, tt, 1), 'submit')

    const map = await svc.orderSummaries([withOrder.id, without.id, randomUUID()])
    expect([...map.keys()]).toEqual([withOrder.id])
    expect(map.get(withOrder.id)).toMatchObject({ orderCount: 1, totalGross: tt.price })
    expect((await svc.orderSummaries([])).size).toBe(0)
    expect((await rpc(sale, 'customer_order_summary', { p_customer_ids: null })).data).toEqual([])
  })

  it('is denied to roles that cannot work with customers', async () => {
    const { data: customer } = await serviceClient()
      .from('customers')
      .select('id')
      .limit(1)
      .single()
    for (const client of [
      warehouse,
      await clientFor(TEST_USERS.production),
      await clientFor(TEST_USERS.inactive),
    ]) {
      const { error } = await rpc(client, 'customer_order_summary', {
        p_customer_ids: [customer?.id],
      })
      expect(error?.code).toBe('42501')
    }
  })
})
