import { randomInt, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { serviceClient, signedInClient, TEST_USERS } from './helpers'

let admin: SupabaseClient
let sale: SupabaseClient
let customerId: string
beforeAll(async () => {
  admin = await signedInClient(TEST_USERS.admin)
  sale = await signedInClient(TEST_USERS.sale)
  const config = await serviceClient()
    .from('app_settings')
    .upsert(
      {
        key: 'sepay_config',
        value: { bank: 'MBBank', account_no: '0123456789', account_name: 'CONG TY TEST' } as never,
      },
      { onConflict: 'key' },
    )
  expect(config.error).toBeNull()
  const result = await serviceClient()
    .from('customers')
    .select('id')
    .eq('phone_normalized', '0900000003')
    .single()
  expect(result.error).toBeNull()
  customerId = result.data!.id
})

async function order() {
  const tag = randomUUID()
  const product = await serviceClient()
    .from('products')
    .insert({
      sku: `P-SEC008-${tag}`,
      name: 'Kiểm thử replay',
      list_price: 100000,
      default_commission_rate: 0,
    })
    .select('id')
    .single()
  expect(product.error).toBeNull()
  const draft = await sale.rpc('save_draft_order', {
    p_order_id: null,
    p_customer_id: customerId,
    p_items: [{ product_id: product.data!.id, quantity: 5 }],
    p_discount_amount: 0,
  })
  expect(draft.error).toBeNull()
  const row = draft.data as { id: string; order_code: string }
  expect(
    (await sale.rpc('transition_order', { p_order_id: row.id, p_action: 'submit', p_reason: null }))
      .error,
  ).toBeNull()
  expect(
    (
      await admin.rpc('transition_order', {
        p_order_id: row.id,
        p_action: 'confirm',
        p_reason: null,
      })
    ).error,
  ).toBeNull()
  return row
}
function payload(row: { order_code: string }, id = randomInt(1000000000000, 2000000000000)) {
  return {
    id,
    gateway: 'MBBank',
    accountNumber: '0123456789',
    transferType: 'in',
    transferAmount: 100000,
    code: row.order_code,
    content: `${row.order_code} thanh toan`,
    transactionDate: '2026-10-03 10:00:00',
  }
}
const send = (body: Record<string, unknown>) =>
  serviceClient().rpc('process_sepay_webhook', { p_payload: body })
async function state(id: number, orders: string[]) {
  const events = await serviceClient()
    .from('payment_events')
    .select('payload, order_id, outcome')
    .eq('provider', 'SEPAY')
    .eq('provider_event_id', String(id))
  const payments = await serviceClient()
    .from('payments')
    .select('order_id, amount')
    .eq('provider', 'SEPAY')
    .eq('provider_reference', String(id))
  const rows = await serviceClient()
    .from('orders')
    .select('id, paid_amount')
    .in('id', orders)
    .order('id')
  for (const result of [events, payments, rows]) expect(result.error).toBeNull()
  return { events: events.data!, payments: payments.data!, rows: rows.data! }
}

describe('SEC-008 immutable webhook replay', () => {
  it('changed amount, target order and content cannot rewrite an accepted transaction', async () => {
    const a = await order(),
      b = await order()
    const first = payload(a)
    const accepted = await send(first)
    expect(accepted.error).toBeNull()
    expect(accepted.data).toMatchObject({ status: 'CREDITED' })
    const before = await state(first.id, [a.id, b.id])
    for (const patch of [
      { transferAmount: 200000 },
      { code: b.order_code, content: b.order_code },
      { content: 'changed synthetic content' },
    ]) {
      const retry = await send({ ...first, ...patch })
      expect(retry.error).toBeNull()
      expect(retry.data).toMatchObject({ status: 'DUPLICATE' })
    }
    expect(await state(first.id, [a.id, b.id])).toEqual(before)
    expect(before.events).toEqual([{ payload: first, order_id: a.id, outcome: 'CREDITED' }])
    expect(before.payments).toEqual([{ order_id: a.id, amount: 100000 }])
  })
  it('concurrent copies targeting two orders choose exactly one immutable winner', async () => {
    const a = await order(),
      b = await order()
    const first = payload(a),
      second = payload(b, first.id)
    const copies = Array.from({ length: 8 }, (_, i) => (i % 2 ? first : second))
    const results = await Promise.all(copies.map(send))
    expect(results.every((r) => r.error === null)).toBe(true)
    const winners = results.flatMap((r, i) =>
      (r.data as { status: string }).status === 'CREDITED' ? [copies[i]] : [],
    )
    expect(winners).toHaveLength(1)
    expect(
      results.filter((r) => (r.data as { status: string }).status === 'DUPLICATE'),
    ).toHaveLength(7)
    const winnerId = winners[0].code === a.order_code ? a.id : b.id
    const snapshot = await state(first.id, [a.id, b.id])
    expect(snapshot.events).toEqual([
      { payload: winners[0], order_id: winnerId, outcome: 'CREDITED' },
    ])
    expect(snapshot.payments).toEqual([{ order_id: winnerId, amount: 100000 }])
    expect(snapshot.rows).toHaveLength(2)
    for (const row of snapshot.rows) expect(row.paid_amount).toBe(row.id === winnerId ? 100000 : 0)
  })
  it('an oversized amount stays ignored when the same event is retried with a valid amount', async () => {
    const a = await order(),
      first = payload(a)
    const ignoredPayload = { ...first, transferAmount: '9223372036854775808' }
    const ignored = await send(ignoredPayload)
    expect(ignored.error).toBeNull()
    expect(ignored.data).toMatchObject({ status: 'IGNORED' })
    const before = await state(first.id, [a.id])
    expect(before.events).toEqual([{ payload: ignoredPayload, order_id: null, outcome: 'IGNORED' }])
    expect(before.payments).toEqual([])
    expect(before.rows).toEqual([{ id: a.id, paid_amount: 0 }])
    const retry = await send(first)
    expect(retry.error).toBeNull()
    expect(retry.data).toMatchObject({ status: 'DUPLICATE', previous_outcome: 'IGNORED' })
    expect(await state(first.id, [a.id])).toEqual(before)
  })
})
