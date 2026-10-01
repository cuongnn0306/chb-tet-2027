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
let customer: string

beforeAll(async () => {
  ;[admin, sale, store, warehouse] = await Promise.all([
    clientFor(TEST_USERS.admin),
    clientFor(TEST_USERS.sale),
    clientFor(TEST_USERS.store),
    clientFor(TEST_USERS.warehouse),
  ])
  const { data } = await serviceClient()
    .from('customers')
    .select('id')
    .eq('phone_normalized', '0900000003')
    .single()
  customer = data?.id as string
})

const svc = () => serviceClient()
const act = (client: AppSupabaseClient, id: string, action: string, reason?: string) =>
  rpc(client, 'transition_order', { p_order_id: id, p_action: action, p_reason: reason ?? null })

/** Runs `fn` with deposit settings temporarily changed, always restoring the originals. */
async function withDeposit(type: string | null, value: number | null, fn: () => Promise<void>) {
  const { data: before } = await svc()
    .from('app_settings')
    .select('key, value')
    .in('key', ['default_deposit_type', 'default_deposit_value'])
  const restore = Object.fromEntries((before ?? []).map((r) => [r.key, r.value]))
  try {
    const write = async (key: string, v: unknown) => {
      if (v === null) await svc().from('app_settings').delete().eq('key', key)
      else
        await svc()
          .from('app_settings')
          .upsert({ key, value: v as never }, { onConflict: 'key' })
    }
    await write('default_deposit_type', type)
    await write('default_deposit_value', value)
    await fn()
  } finally {
    for (const key of ['default_deposit_type', 'default_deposit_value']) {
      await svc()
        .from('app_settings')
        .upsert({ key, value: restore[key] as never }, { onConflict: 'key' })
    }
  }
}

/** A fresh product + location with stock so orders are realistic and isolated. */
async function product(price: number) {
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data: p } = await svc()
    .from('products')
    .insert({
      sku: `P-PY-${tag}`,
      name: `Sản phẩm thanh toán ${tag}`,
      list_price: price,
      default_commission_rate: 0,
    })
    .select('id')
    .single()
  return p?.id as string
}

async function draftOrder(productId: string, qty: number, client = sale) {
  const { data, error } = await rpc(client, 'save_draft_order', {
    p_order_id: null,
    p_customer_id: customer,
    p_items: [{ product_id: productId, quantity: qty }],
    p_discount_amount: 0,
  })
  expect(error).toBeNull()
  return data as { id: string; order_code: string; net_amount: number }
}

/** Submitted order awaiting the Admin's confirmation. */
async function submittedOrder(price = 100000, qty = 5) {
  const productId = await product(price)
  const order = await draftOrder(productId, qty)
  expect((await act(sale, order.id, 'submit')).error).toBeNull()
  return order
}

async function waitingDeposit(price = 100000, qty = 5) {
  const order = await submittedOrder(price, qty)
  const confirmed = await act(admin, order.id, 'confirm')
  expect(confirmed.error).toBeNull()
  return {
    ...order,
    status: confirmed.data.status as string,
    deposit: confirmed.data.deposit_required as number,
  }
}

const orderRow = async (id: string) =>
  (
    await svc()
      .from('orders')
      .select('status, paid_amount, remaining_amount, deposit_required, net_amount')
      .eq('id', id)
      .single()
  ).data

const webhook = (payload: Record<string, unknown>) =>
  svc().rpc('process_sepay_webhook', { p_payload: payload as never })
const sepayId = () => Math.floor(Math.random() * 1e12) + 1e12

const transfer = (
  order: { order_code: string },
  amount: number,
  over: Record<string, unknown> = {},
) => ({
  id: sepayId(),
  gateway: 'MBBank',
  transactionDate: '2026-10-02 10:20:30',
  accountNumber: '0123456789',
  code: order.order_code,
  content: `${order.order_code} thanh toan`,
  transferType: 'in',
  transferAmount: amount,
  referenceCode: `FT${randomUUID().slice(0, 8)}`,
  ...over,
})

describe('deposit policy (PAY-003)', () => {
  it('percent deposit is rounded UP to whole VND and set when the Admin confirms', async () => {
    await withDeposit('PERCENT', 30, async () => {
      const order = await submittedOrder(33333, 1) // 30% of 33.333 = 9.999,9 -> 10.000
      const confirmed = await act(admin, order.id, 'confirm')
      expect(confirmed.data.status).toBe('WAITING_DEPOSIT')
      expect(confirmed.data.deposit_required).toBe(10000)
    })
  })

  it('fixed deposit never exceeds the order value', async () => {
    await withDeposit('FIXED_AMOUNT', 200000, async () => {
      const big = await submittedOrder(100000, 5)
      expect((await act(admin, big.id, 'confirm')).data.deposit_required).toBe(200000)
      const small = await submittedOrder(50000, 1)
      expect((await act(admin, small.id, 'confirm')).data.deposit_required).toBe(50000)
    })
  })

  it('a 0 deposit confirms the order straight away', async () => {
    await withDeposit('PERCENT', 0, async () => {
      const order = await submittedOrder()
      const confirmed = await act(admin, order.id, 'confirm')
      expect(confirmed.error).toBeNull()
      const row = await orderRow(order.id)
      expect(row?.status).toBe('CONFIRMED')
      expect(row?.deposit_required).toBe(0)
      const { data: history } = await svc()
        .from('order_status_history')
        .select('to_status')
        .eq('order_id', order.id)
        .order('created_at')
      expect(history?.map((h) => h.to_status)).toEqual([
        'DRAFT',
        'WAITING_CONFIRMATION',
        'WAITING_DEPOSIT',
        'CONFIRMED',
      ])
    })
  })

  it('refuses to confirm when the policy is not configured, leaving the order untouched', async () => {
    await withDeposit(null, null, async () => {
      const order = await submittedOrder()
      const { error } = await act(admin, order.id, 'confirm')
      expect(error?.message).toMatch(/Chưa cấu hình chính sách cọc/)
      expect((await orderRow(order.id))?.status).toBe('WAITING_CONFIRMATION')
    })
  })

  it('paying the deposit confirms the order automatically and replaces the hold with demand commitment', async () => {
    const order = await waitingDeposit() // net 500.000, deposit 30% = 150.000
    expect(order.deposit).toBe(150000)
    expect(
      (await svc().from('inventory_reservations').select('id').eq('order_id', order.id)).data,
    ).toBeDefined()

    const part = await rpc(admin, 'record_payment', {
      p_order_id: order.id,
      p_method: 'CASH',
      p_amount: 100000,
    })
    expect(part.error).toBeNull()
    expect((await orderRow(order.id))?.status).toBe('WAITING_DEPOSIT') // 100k < 150k

    expect(
      (
        await rpc(admin, 'record_payment', {
          p_order_id: order.id,
          p_method: 'BANK_TRANSFER',
          p_amount: 50000,
        })
      ).error,
    ).toBeNull()
    const row = await orderRow(order.id)
    expect(row).toMatchObject({
      status: 'CONFIRMED',
      paid_amount: 150000,
      remaining_amount: 350000,
    })
    const { data: history } = await svc()
      .from('order_status_history')
      .select('to_status')
      .eq('order_id', order.id)
      .order('created_at')
    expect(history?.map((h) => h.to_status).slice(-2)).toEqual(['WAITING_DEPOSIT', 'CONFIRMED'])
    const { data: confirmedAt } = await svc()
      .from('orders')
      .select('confirmed_at')
      .eq('id', order.id)
      .single()
    expect(confirmedAt?.confirmed_at).not.toBeNull()
  })

  it('money that arrived before the Admin confirmed counts toward the deposit', async () => {
    const order = await submittedOrder() // WAITING_CONFIRMATION
    await rpc(admin, 'record_payment', { p_order_id: order.id, p_method: 'CASH', p_amount: 200000 })
    expect((await act(admin, order.id, 'confirm')).data.status).toBe('CONFIRMED')
  })
})

describe('manual payments (PAY-002)', () => {
  it('Admin records cash/transfer/COD; paid and remaining are derived, never typed', async () => {
    const order = await waitingDeposit()
    const cash = await rpc(admin, 'record_payment', {
      p_order_id: order.id,
      p_method: 'CASH',
      p_amount: 200000,
      p_note: 'Thu tiền mặt',
    })
    expect(cash.error).toBeNull()
    expect(cash.data).toMatchObject({ status: 'CONFIRMED', method: 'CASH', amount: 200000 })
    expect(cash.data.payment_code).toMatch(/^PAY\d{6,}$/)
    expect(cash.data.confirmed_by).not.toBeNull()

    const cod = await rpc(admin, 'record_payment', {
      p_order_id: order.id,
      p_method: 'COD',
      p_amount: 100000,
      p_confirm: false,
    })
    expect(cod.data.status).toBe('PENDING')
    expect((await orderRow(order.id))?.paid_amount).toBe(200000) // pending money does not count

    expect((await rpc(admin, 'confirm_payment', { p_payment_id: cod.data.id })).data.status).toBe(
      'CONFIRMED',
    )
    expect(await orderRow(order.id)).toMatchObject({
      paid_amount: 300000,
      remaining_amount: 200000,
    })
  })

  it('is Admin-only', async () => {
    const order = await waitingDeposit()
    for (const client of [sale, store, warehouse]) {
      expect(
        (
          await rpc(client, 'record_payment', {
            p_order_id: order.id,
            p_method: 'CASH',
            p_amount: 1000,
          })
        ).error?.code,
      ).toBe('42501')
    }
    expect((await orderRow(order.id))?.paid_amount).toBe(0)
  })

  it('refuses invalid amounts, overpayment and orders that cannot take money', async () => {
    const order = await waitingDeposit()
    const pay = (amount: number, id = order.id) =>
      rpc(admin, 'record_payment', { p_order_id: id, p_method: 'CASH', p_amount: amount })
    expect((await pay(0)).error?.message).toMatch(/lớn hơn 0/)
    expect((await pay(-5)).error?.message).toMatch(/lớn hơn 0/)
    expect((await pay(500001)).error?.message).toMatch(/vượt quá số còn phải thu.*500000/)
    expect(
      (
        await rpc(admin, 'record_payment', {
          p_order_id: order.id,
          p_method: 'BITCOIN',
          p_amount: 10,
        })
      ).error,
    ).not.toBeNull()
    expect((await orderRow(order.id))?.paid_amount).toBe(0)

    const draft = await draftOrder(await product(100000), 1)
    expect((await pay(1000, draft.id)).error?.message).toMatch(/không nhận thanh toán/)
    const cancelled = await submittedOrder()
    await act(sale, cancelled.id, 'cancel', 'Hủy')
    expect((await pay(1000, cancelled.id)).error?.message).toMatch(/không nhận thanh toán/)
  })

  it('never lets a payment push the order beyond its net amount, even when two arrive at once', async () => {
    const order = await waitingDeposit() // net 500.000
    const results = await Promise.all([
      rpc(admin, 'record_payment', { p_order_id: order.id, p_method: 'CASH', p_amount: 300000 }),
      rpc(admin, 'record_payment', { p_order_id: order.id, p_method: 'CASH', p_amount: 300000 }),
    ])
    expect(results.filter((r) => r.error === null)).toHaveLength(1)
    expect(results.find((r) => r.error)?.error.message).toMatch(/vượt quá số còn phải thu/)
    expect((await orderRow(order.id))?.paid_amount).toBe(300000)
  })

  it('fail / void need a reason; refund reduces paid; closed payments cannot change', async () => {
    const order = await waitingDeposit()
    const pending = await rpc(admin, 'record_payment', {
      p_order_id: order.id,
      p_method: 'COD',
      p_amount: 50000,
      p_confirm: false,
    })
    expect(
      (await rpc(admin, 'void_payment', { p_payment_id: pending.data.id, p_reason: '  ' })).error
        ?.message,
    ).toMatch(/lý do/)
    expect(
      (
        await rpc(admin, 'void_payment', {
          p_payment_id: pending.data.id,
          p_reason: 'Khách không giao COD',
        })
      ).data.status,
    ).toBe('VOIDED')
    expect(
      (await rpc(admin, 'confirm_payment', { p_payment_id: pending.data.id })).error,
    ).not.toBeNull() // closed

    const failing = await rpc(admin, 'record_payment', {
      p_order_id: order.id,
      p_method: 'BANK_TRANSFER',
      p_amount: 10000,
      p_confirm: false,
    })
    expect(
      (
        await rpc(admin, 'fail_payment', {
          p_payment_id: failing.data.id,
          p_reason: 'Giao dịch lỗi',
        })
      ).data.status,
    ).toBe('FAILED')

    const paid = await rpc(admin, 'record_payment', {
      p_order_id: order.id,
      p_method: 'CASH',
      p_amount: 150000,
    })
    expect((await orderRow(order.id))?.paid_amount).toBe(150000)
    expect(
      (await rpc(admin, 'refund_payment', { p_payment_id: paid.data.id, p_reason: '' })).error
        ?.message,
    ).toMatch(/lý do/)
    expect(
      (await rpc(admin, 'refund_payment', { p_payment_id: paid.data.id, p_reason: 'Khách đổi ý' }))
        .data,
    ).toMatchObject({ status: 'REFUNDED', status_reason: 'Khách đổi ý' })
    expect((await orderRow(order.id))?.paid_amount).toBe(0)
    expect(
      (await rpc(admin, 'refund_payment', { p_payment_id: paid.data.id, p_reason: 'Lần hai' }))
        .error,
    ).not.toBeNull()
    expect(
      (await rpc(admin, 'void_payment', { p_payment_id: paid.data.id, p_reason: 'x' })).error,
    ).not.toBeNull()
  })

  it('a refund frees the order to be cancelled (E03 blocked cancelling paid orders)', async () => {
    const order = await waitingDeposit()
    const paid = await rpc(admin, 'record_payment', {
      p_order_id: order.id,
      p_method: 'CASH',
      p_amount: 150000,
    }) // -> CONFIRMED
    expect((await act(admin, order.id, 'cancel', 'Hủy đơn')).error?.message).toMatch(
      /đã có thanh toán/,
    )
    await rpc(admin, 'refund_payment', { p_payment_id: paid.data.id, p_reason: 'Hoàn cọc' })
    expect((await act(admin, order.id, 'cancel', 'Hủy đơn')).error).toBeNull()
  })
})

describe('payment records are protected', () => {
  it('amount, order, method and provider identity cannot change; nothing is deleted; paid_amount cannot be edited', async () => {
    const order = await waitingDeposit()
    const pay = await rpc(admin, 'record_payment', {
      p_order_id: order.id,
      p_method: 'CASH',
      p_amount: 100000,
    })
    const id = pay.data.id as string
    expect(
      (await svc().from('payments').update({ amount: 1 }).eq('id', id)).error?.message,
    ).toMatch(/Không được sửa/)
    expect(
      (await svc().from('payments').update({ method: 'COD' }).eq('id', id)).error?.message,
    ).toMatch(/Không được sửa/)
    expect(
      (
        await svc()
          .from('payments')
          .update({ order_id: (await submittedOrder()).id })
          .eq('id', id)
      ).error?.message,
    ).toMatch(/Không được sửa/)
    expect((await svc().from('payments').delete().eq('id', id)).error?.message).toMatch(
      /Không được xóa/,
    )

    for (const patch of [{ paid_amount: 999999 }, { deposit_required: 0 }]) {
      expect((await svc().from('orders').update(patch).eq('id', order.id)).error?.message).toMatch(
        /Không được sửa số tiền/,
      )
    }
    expect(await orderRow(order.id)).toMatchObject({
      paid_amount: 100000,
      deposit_required: 150000,
    })
  })

  it('shows payments to the order owner and Admin only, and blocks all client writes', async () => {
    const order = await waitingDeposit()
    const pay = await rpc(admin, 'record_payment', {
      p_order_id: order.id,
      p_method: 'CASH',
      p_amount: 1000,
    })
    for (const client of [sale, admin]) {
      expect(
        (await client.from('payments').select('id').eq('order_id', order.id)).data,
      ).toHaveLength(1)
    }
    for (const client of [store, warehouse]) {
      expect(
        (await client.from('payments').select('id').eq('order_id', order.id)).data ?? [],
      ).toHaveLength(0)
    }
    for (const client of [sale, admin]) {
      const ins = await client
        .from('payments')
        .insert({ order_id: order.id, payment_code: 'X', method: 'CASH', amount: 5 } as never)
      expect(ins.error).not.toBeNull()
      const upd = await client
        .from('payments')
        .update({ status: 'REFUNDED' } as never)
        .eq('id', pay.data.id)
        .select()
      expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true)
    }
  })
})

describe('SePay webhook (PAY-007, PAY-008)', () => {
  it('credits a matching transfer once and reports it', async () => {
    const order = await waitingDeposit()
    const event = transfer(order, 150000)
    const { data, error } = await webhook(event)
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'CREDITED', order_id: order.id })

    const { data: payment } = await svc()
      .from('payments')
      .select('*')
      .eq('id', (data as any).payment_id)
      .single()
    expect(payment).toMatchObject({
      status: 'CONFIRMED',
      method: 'QR',
      amount: 150000,
      provider: 'SEPAY',
      provider_reference: String(event.id),
    })
    expect(payment?.transfer_content).toContain(order.order_code)
    expect(new Date(payment?.paid_at as string).toISOString()).toBe('2026-10-02T03:20:30.000Z') // 10:20:30 Vietnam time
    expect((await orderRow(order.id))?.status).toBe('CONFIRMED')
  })

  it('a retried delivery of the same event never credits twice', async () => {
    const order = await waitingDeposit()
    const event = transfer(order, 100000)
    expect((await webhook(event)).data).toMatchObject({ status: 'CREDITED' })
    for (let i = 0; i < 3; i++)
      expect((await webhook(event)).data).toMatchObject({
        status: 'DUPLICATE',
        previous_outcome: 'CREDITED',
      })
    expect((await svc().from('payments').select('id').eq('order_id', order.id)).data).toHaveLength(
      1,
    )
    expect((await orderRow(order.id))?.paid_amount).toBe(100000)
  })

  it('concurrent duplicate deliveries credit exactly once', async () => {
    const order = await waitingDeposit()
    const event = transfer(order, 120000)
    const results = await Promise.all(Array.from({ length: 6 }, () => webhook(event)))
    expect(results.every((r) => r.error === null)).toBe(true)
    const statuses = results.map((r) => (r.data as any).status).sort()
    expect(statuses).toEqual([
      'CREDITED',
      'DUPLICATE',
      'DUPLICATE',
      'DUPLICATE',
      'DUPLICATE',
      'DUPLICATE',
    ])
    expect((await svc().from('payments').select('id').eq('order_id', order.id)).data).toHaveLength(
      1,
    )
    expect((await orderRow(order.id))?.paid_amount).toBe(120000)
    expect(
      (await svc().from('payment_events').select('id').eq('provider_event_id', String(event.id)))
        .data,
    ).toHaveLength(1)
  })

  it('a second layer also blocks the same provider reference on the payments table', async () => {
    const order = await waitingDeposit()
    const event = transfer(order, 10000)
    await webhook(event)
    const dup = await svc()
      .from('payments')
      .insert({
        order_id: order.id,
        payment_code: '',
        method: 'QR',
        amount: 10000,
        status: 'PENDING',
        provider: 'SEPAY',
        provider_reference: String(event.id),
      })
    expect(dup.error?.code).toBe('23505')
  })

  it('matches the order from the transfer content when the provider sends no code', async () => {
    const order = await waitingDeposit()
    const event = transfer(order, 50000, {
      code: null,
      content: `Chuyen khoan ${order.order_code.toLowerCase()} coc don`,
    })
    const { data } = await webhook(event)
    expect(data).toMatchObject({ status: 'CREDITED', order_id: order.id })
  })

  it('logs a payment for an unknown code instead of guessing, and ignores outgoing money or bad amounts', async () => {
    const unknown = await webhook(transfer({ order_code: 'TET999999' }, 50000))
    expect(unknown.data).toMatchObject({ status: 'UNMATCHED' })
    expect(
      (await webhook(transfer({ order_code: 'X' }, 1, { code: null, content: 'khong co ma' })))
        .data,
    ).toMatchObject({ status: 'UNMATCHED' })

    const order = await waitingDeposit()
    expect((await webhook(transfer(order, 50000, { transferType: 'out' }))).data).toMatchObject({
      status: 'IGNORED',
    })
    expect((await webhook(transfer(order, 0))).data).toMatchObject({ status: 'IGNORED' })
    expect((await webhook(transfer(order, -5))).data).toMatchObject({ status: 'IGNORED' })
    expect((await webhook(transfer(order, 1.5))).data).toMatchObject({ status: 'IGNORED' })
    expect((await orderRow(order.id))?.paid_amount).toBe(0)
  })

  it('does not credit an overpayment or a closed order: it goes to review as a PENDING payment', async () => {
    const order = await waitingDeposit() // net 500.000
    const over = await webhook(transfer(order, 600000))
    expect(over.data).toMatchObject({ status: 'NEEDS_REVIEW' })
    expect((await orderRow(order.id))?.paid_amount).toBe(0)
    const { data: pending } = await svc()
      .from('payments')
      .select('status, note')
      .eq('id', (over.data as any).payment_id)
      .single()
    expect(pending?.status).toBe('PENDING')
    expect(pending?.note).toMatch(/lớn hơn số còn phải thu/)

    const closed = await submittedOrder()
    await act(sale, closed.id, 'cancel', 'Hủy')
    expect((await webhook(transfer(closed, 100000))).data).toMatchObject({ status: 'NEEDS_REVIEW' })
    expect((await orderRow(closed.id))?.paid_amount).toBe(0)
  })

  it('rejects an event without an id and is callable by the server only', async () => {
    expect((await webhook({ transferAmount: 1000 })).error?.message).toMatch(/thiếu mã giao dịch/)
    for (const client of [admin, sale]) {
      expect(
        (await rpc(client, 'process_sepay_webhook', { p_payload: { id: 1 } })).error,
      ).not.toBeNull()
    }
    const { url, anonKey } = getLocalConfig()
    const anon = createClient<Database>(url, anonKey, { auth: { persistSession: false } })
    expect(
      (await anon.rpc('process_sepay_webhook' as never, { p_payload: { id: 1 } } as never)).error,
    ).not.toBeNull()
  })

  it('partial transfers add up until the deposit is covered', async () => {
    const order = await waitingDeposit() // deposit 150.000
    await webhook(transfer(order, 100000))
    expect((await orderRow(order.id))?.status).toBe('WAITING_DEPOSIT')
    await webhook(transfer(order, 50000))
    expect(await orderRow(order.id)).toMatchObject({ status: 'CONFIRMED', paid_amount: 150000 })
  })
})

describe('review queue', () => {
  it('Admin assigns an unmatched transfer to an order; it credits once and cannot be reused', async () => {
    const order = await waitingDeposit()
    const event = transfer({ order_code: 'SAI-MA' }, 150000, {
      code: 'SAI-MA',
      content: 'sai noi dung',
    })
    await webhook(event)
    const { data: row } = await svc()
      .from('payment_events')
      .select('id')
      .eq('provider_event_id', String(event.id))
      .single()

    expect(
      (await rpc(sale, 'assign_payment_event', { p_event_id: row?.id, p_order_id: order.id })).error
        ?.code,
    ).toBe('42501')
    const assigned = await rpc(admin, 'assign_payment_event', {
      p_event_id: row?.id,
      p_order_id: order.id,
    })
    expect(assigned.error).toBeNull()
    expect(assigned.data).toMatchObject({ status: 'CONFIRMED', amount: 150000, provider: 'SEPAY' })
    expect((await orderRow(order.id))?.status).toBe('CONFIRMED')

    const { data: after } = await svc()
      .from('payment_events')
      .select('outcome, resolved_at, order_id')
      .eq('id', row?.id as string)
      .single()
    expect(after).toMatchObject({ outcome: 'CREDITED', order_id: order.id })
    expect(after?.resolved_at).not.toBeNull()
    expect(
      (await rpc(admin, 'assign_payment_event', { p_event_id: row?.id, p_order_id: order.id }))
        .error,
    ).not.toBeNull()
  })

  it('Admin can dismiss an event with a note; the queue and log are Admin-only', async () => {
    const event = transfer({ order_code: 'KHONG-RO' }, 20000, {
      code: 'KHONG-RO',
      content: 'nhầm tài khoản',
    })
    await webhook(event)
    const { data: row } = await svc()
      .from('payment_events')
      .select('id')
      .eq('provider_event_id', String(event.id))
      .single()

    expect(
      (await rpc(admin, 'dismiss_payment_event', { p_event_id: row?.id, p_note: ' ' })).error
        ?.message,
    ).toMatch(/ghi chú/)
    expect(
      (
        await rpc(admin, 'dismiss_payment_event', {
          p_event_id: row?.id,
          p_note: 'Đã hoàn tiền cho khách',
        })
      ).error,
    ).toBeNull()
    expect(
      (
        await svc()
          .from('payment_events')
          .select('resolved_at')
          .eq('id', row?.id as string)
          .single()
      ).data?.resolved_at,
    ).not.toBeNull()

    expect(
      (
        await admin
          .from('payment_events')
          .select('id')
          .eq('id', row?.id as string)
      ).data,
    ).toHaveLength(1)
    for (const client of [sale, store, warehouse]) {
      expect(
        (
          await client
            .from('payment_events')
            .select('id')
            .eq('id', row?.id as string)
        ).data ?? [],
      ).toHaveLength(0)
    }
    expect(
      (
        await svc()
          .from('payment_events')
          .update({ payload: {} })
          .eq('id', row?.id as string)
      ).error?.message,
    ).toMatch(/không được sửa nội dung gốc/)
    expect(
      (
        await svc()
          .from('payment_events')
          .delete()
          .eq('id', row?.id as string)
      ).error?.message,
    ).toMatch(/Không được xóa/)
  })
})

describe('payment instructions (PAY-004, PAY-005)', () => {
  it('gives the owner the amount to pay, the payment code and the bank details', async () => {
    await svc()
      .from('app_settings')
      .upsert(
        {
          key: 'sepay_config',
          value: {
            bank: 'MBBank',
            account_no: '0123456789',
            account_name: 'CONG TY TEST',
          } as never,
        },
        { onConflict: 'key' },
      )
    const order = await waitingDeposit()
    const { data, error } = await rpc(sale, 'payment_instructions', { p_order_id: order.id })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      order_code: order.order_code,
      transfer_content: order.order_code,
      status: 'WAITING_DEPOSIT',
      net_amount: 500000,
      deposit_required: 150000,
      paid_amount: 0,
      amount_due: 150000,
      configured: true,
      bank: 'MBBank',
      account_no: '0123456789',
      account_name: 'CONG TY TEST',
    })

    await rpc(admin, 'record_payment', { p_order_id: order.id, p_method: 'CASH', p_amount: 50000 })
    expect((await rpc(sale, 'payment_instructions', { p_order_id: order.id })).data).toMatchObject({
      amount_due: 100000,
      paid_amount: 50000,
    })
    await rpc(admin, 'record_payment', { p_order_id: order.id, p_method: 'CASH', p_amount: 100000 }) // deposit covered -> CONFIRMED
    expect((await rpc(sale, 'payment_instructions', { p_order_id: order.id })).data).toMatchObject({
      status: 'CONFIRMED',
      amount_due: 350000,
    })
  })

  it('reports when the bank details are not configured, and is limited to the owner and Admin', async () => {
    const order = await waitingDeposit()
    await svc().from('app_settings').delete().eq('key', 'sepay_config')
    try {
      expect(
        (await rpc(sale, 'payment_instructions', { p_order_id: order.id })).data,
      ).toMatchObject({ configured: false, bank: null })
    } finally {
      await svc()
        .from('app_settings')
        .upsert(
          {
            key: 'sepay_config',
            value: {
              bank: 'MBBank',
              account_no: '0123456789',
              account_name: 'CONG TY TEST',
            } as never,
          },
          { onConflict: 'key' },
        )
    }
    expect((await rpc(admin, 'payment_instructions', { p_order_id: order.id })).error).toBeNull()
    for (const client of [store, warehouse]) {
      expect(
        (await rpc(client, 'payment_instructions', { p_order_id: order.id })).error,
      ).not.toBeNull()
    }
  })
})
