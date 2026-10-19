/* eslint-disable @typescript-eslint/no-explicit-any -- RPC and audit rows are dynamic JSON; the tests assert on their shape */
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { TEST_USERS, serviceClient, signedInClient } from './helpers'

/**
 * SEC-002 / RV-12: every successful Admin decision on a provider payment event (assign to an order,
 * dismiss with a note) leaves exactly one immutable audit row with the decision fields only.
 * Fixtures are isolated: each test inserts its own events (unique ids) and orders; nothing is deleted.
 */

let admin: SupabaseClient
let sale: SupabaseClient
let adminId: string
let customer: string

const svc = () => serviceClient()

const CONFIG = { bank: 'MBBank', account_no: '0123456789', account_name: 'CONG TY TEST' }

// The decision fields, and nothing else, may appear in before_data / after_data.
const DECISION_KEYS = [
  'note',
  'order_id',
  'outcome',
  'payment_id',
  'provider',
  'provider_event_id',
  'resolved_at',
  'resolved_by',
]

beforeAll(async () => {
  ;[admin, sale] = await Promise.all([
    signedInClient(TEST_USERS.admin),
    signedInClient(TEST_USERS.sale),
  ])
  const { data: profile } = await svc()
    .from('profiles')
    .select('id')
    .eq('full_name', 'Admin Test')
    .single()
  adminId = profile?.id as string
  const { data: found } = await svc()
    .from('customers')
    .select('id')
    .eq('phone_normalized', '0900000003')
    .single()
  customer = found?.id as string
  // Only the webhook test needs the receiving account (PAY-007); same values as payments.test.ts.
  await svc()
    .from('app_settings')
    .upsert({ key: 'sepay_config', value: CONFIG }, { onConflict: 'key' })
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const UNMATCHED_NOTE = 'Không tìm thấy đơn hàng cho mã thanh toán "—".'

/** A received provider event waiting in the Admin review queue, with a recognisable raw payload. */
async function newEvent(
  over: { outcome?: 'UNMATCHED' | 'NEEDS_REVIEW'; note?: string; amount?: number } = {},
) {
  const marker = randomUUID().slice(0, 8)
  const outcome = over.outcome ?? 'UNMATCHED'
  const providerEventId = `SEC002-${randomUUID()}`
  const { data, error } = await svc()
    .from('payment_events')
    .insert({
      provider: 'SEPAY',
      provider_event_id: providerEventId,
      payload: {
        id: providerEventId,
        gateway: 'MBBank',
        accountNumber: '0123456789',
        content: `NOIDUNG-${marker}`,
        referenceCode: `FT-${marker}`,
        transferType: 'in',
        transferAmount: over.amount ?? 100000,
      },
      outcome,
      note: over.note ?? (outcome === 'UNMATCHED' ? UNMATCHED_NOTE : 'Cần Admin xử lý.'),
    })
    .select('*')
    .single()
  expect(error).toBeNull()
  return { event: data as any, marker }
}

async function product() {
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data } = await svc()
    .from('products')
    .insert({
      sku: `P-SEC2-${tag}`,
      name: `Sản phẩm audit sự kiện ${tag}`,
      list_price: 100000,
      default_commission_rate: 0,
    })
    .select('id')
    .single()
  return data?.id as string
}

async function draftOrder() {
  const { data, error } = await sale.rpc('save_draft_order', {
    p_order_id: null,
    p_customer_id: customer,
    p_items: [{ product_id: await product(), quantity: 5 }],
    p_discount_amount: 0,
  })
  expect(error).toBeNull()
  return data as { id: string; order_code: string; net_amount: number }
}

/** Submitted order (net 500.000): it accepts payments without going through the deposit flow. */
async function submittedOrder() {
  const order = await draftOrder()
  const { error } = await sale.rpc('transition_order', {
    p_order_id: order.id,
    p_action: 'submit',
    p_reason: null,
  })
  expect(error).toBeNull()
  return order
}

const paidAmount = async (orderId: string) =>
  (await svc().from('orders').select('paid_amount').eq('id', orderId).single()).data?.paid_amount

const eventRow = async (id: string) =>
  (await svc().from('payment_events').select('*').eq('id', id).single()).data as any

const reviewAudit = async (eventId: string) =>
  ((
    await svc()
      .from('audit_logs')
      .select('*')
      .eq('entity_type', 'payment_events')
      .eq('entity_id', eventId)
      .order('created_at')
      .order('id')
  ).data ?? []) as any[]

/** All audit rows about payment events (they only ever come from review decisions). */
const reviewAuditTotal = async () =>
  (
    await svc()
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'payment_events')
  ).count ?? 0

const dismiss = (eventId: string, note: string) =>
  admin.rpc('dismiss_payment_event', { p_event_id: eventId, p_note: note })
const assign = (eventId: string, orderId: string) =>
  admin.rpc('assign_payment_event', { p_event_id: eventId, p_order_id: orderId })

/** Decision fields only: no raw webhook payload, account number, content or reference may be copied. */
function expectMinimal(row: any, marker: string) {
  for (const data of [row.before_data, row.after_data]) {
    expect(Object.keys(data).sort()).toEqual(DECISION_KEYS)
  }
  const text = JSON.stringify([row.before_data, row.after_data, row.reason])
  for (const leaked of [
    'payload',
    'accountNumber',
    'transferAmount',
    'referenceCode',
    'transferType',
    `NOIDUNG-${marker}`,
    `FT-${marker}`,
  ]) {
    expect(text).not.toContain(leaked)
  }
}

const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime()

// ---------------------------------------------------------------------------
describe('dismissing an event (RV-12)', () => {
  it('records actor, event, before/after, timestamp and the Admin note', async () => {
    const { event, marker } = await newEvent()
    const note = 'Đã hoàn tiền cho khách qua ngân hàng'
    expect((await dismiss(event.id, `  ${note}  `)).error).toBeNull()

    const after = await eventRow(event.id)
    const rows = await reviewAudit(event.id)
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row).toMatchObject({
      entity_type: 'payment_events',
      entity_id: event.id,
      action: 'review_dismiss',
      actor_user_id: adminId,
      reason: note,
    })
    expect(row.before_data).toEqual({
      provider: 'SEPAY',
      provider_event_id: event.provider_event_id,
      outcome: 'UNMATCHED',
      order_id: null,
      payment_id: null,
      note: UNMATCHED_NOTE,
      resolved_at: null,
      resolved_by: null,
    })
    expect(row.after_data).toMatchObject({
      outcome: 'UNMATCHED',
      order_id: null,
      payment_id: null,
      note,
      resolved_by: adminId,
    })
    // The audit row carries the decision time: same transaction, same instant.
    expect(sameInstant(row.after_data.resolved_at, after.resolved_at)).toBe(true)
    expect(sameInstant(row.created_at, after.resolved_at)).toBe(true)
    expectMinimal(row, marker)
  })

  it('keeps the system review note that the dismissal overwrites', async () => {
    const systemNote = 'Số tiền 600000 đ lớn hơn số còn phải thu 500000 đ: cần Admin xử lý.'
    const { event, marker } = await newEvent({ outcome: 'NEEDS_REVIEW', note: systemNote })
    const note = 'Đã hoàn 100.000 đ phần dư cho khách'
    expect((await dismiss(event.id, note)).error).toBeNull()

    expect((await eventRow(event.id)).note).toBe(note) // the event itself only keeps the latest note
    const [row, ...rest] = await reviewAudit(event.id)
    expect(rest).toEqual([])
    expect(row).toMatchObject({ action: 'review_dismiss', actor_user_id: adminId, reason: note })
    expect(row.before_data).toMatchObject({ outcome: 'NEEDS_REVIEW', note: systemNote })
    expect(row.after_data).toMatchObject({ outcome: 'NEEDS_REVIEW', note, resolved_by: adminId })
    expectMinimal(row, marker)
  })
})

describe('assigning an unmatched event to an order (RV-12)', () => {
  it('records one audit row and still credits the order exactly once', async () => {
    const order = await submittedOrder()
    const { event, marker } = await newEvent({ amount: 100000 })
    const { data: payment, error } = await assign(event.id, order.id)
    expect(error).toBeNull()
    expect(payment).toMatchObject({
      status: 'CONFIRMED',
      amount: 100000,
      provider: 'SEPAY',
      provider_reference: event.provider_event_id,
    })
    expect(await paidAmount(order.id)).toBe(100000)

    const after = await eventRow(event.id)
    const rows = await reviewAudit(event.id)
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row).toMatchObject({
      entity_type: 'payment_events',
      entity_id: event.id,
      action: 'review_assign',
      actor_user_id: adminId,
    })
    expect(row.reason).toMatch(/gán thủ công/)
    expect(row.before_data).toEqual({
      provider: 'SEPAY',
      provider_event_id: event.provider_event_id,
      outcome: 'UNMATCHED',
      order_id: null,
      payment_id: null,
      note: UNMATCHED_NOTE,
      resolved_at: null,
      resolved_by: null,
    })
    expect(row.after_data).toMatchObject({
      outcome: 'CREDITED',
      order_id: order.id,
      payment_id: payment.id,
      note: UNMATCHED_NOTE,
      resolved_by: adminId,
    })
    expect(sameInstant(row.after_data.resolved_at, after.resolved_at)).toBe(true)
    expect(sameInstant(row.created_at, after.resolved_at)).toBe(true)
    expectMinimal(row, marker)
  })
})

describe('failed decisions leave no audit row', () => {
  it('refuses non-Admin users', async () => {
    const order = await submittedOrder()
    const { event } = await newEvent()
    const before = await reviewAuditTotal()

    expect(
      (await sale.rpc('assign_payment_event', { p_event_id: event.id, p_order_id: order.id })).error
        ?.code,
    ).toBe('42501')
    expect(
      (await sale.rpc('dismiss_payment_event', { p_event_id: event.id, p_note: 'Đã xử lý' })).error
        ?.code,
    ).toBe('42501')

    expect(await reviewAuditTotal()).toBe(before)
    expect(await eventRow(event.id)).toMatchObject({
      outcome: 'UNMATCHED',
      payment_id: null,
      resolved_at: null,
      resolved_by: null,
    })
    expect(await paidAmount(order.id)).toBe(0)
  })

  it('refuses invalid input and states, and rolls back a decision whose payment is refused', async () => {
    const draft = await draftOrder() // DRAFT orders do not accept payments
    const { event } = await newEvent()
    const { event: review } = await newEvent({ outcome: 'NEEDS_REVIEW' })
    const before = await reviewAuditTotal()

    expect((await dismiss(event.id, '   ')).error?.message).toMatch(/ghi chú/)
    expect((await dismiss(randomUUID(), 'Đã xử lý')).error?.message).toMatch(
      /Không tìm thấy giao dịch cần xử lý/,
    )
    // The payment is refused after the decision was started: nothing may remain, event or audit.
    expect((await assign(event.id, draft.id)).error?.message).toMatch(/không nhận thanh toán/)
    expect((await assign(event.id, randomUUID())).error).not.toBeNull() // unknown order
    expect((await assign(review.id, draft.id)).error?.message).toMatch(
      /không còn ở trạng thái chưa khớp/, // only UNMATCHED events can be assigned
    )
    expect((await assign(randomUUID(), draft.id)).error?.message).toMatch(
      /không còn ở trạng thái chưa khớp/,
    )

    expect(await reviewAuditTotal()).toBe(before)
    for (const e of [event, review]) {
      expect(await eventRow(e.id)).toMatchObject({
        payment_id: null,
        order_id: null,
        resolved_at: null,
        resolved_by: null,
      })
    }
    expect(
      (await svc().from('payments').select('id').eq('provider_reference', event.provider_event_id))
        .data,
    ).toEqual([])
  })
})

describe('repeated and concurrent decisions', () => {
  it('a second decision on a resolved event is refused and adds no audit row', async () => {
    const order = await submittedOrder()
    const { event: dismissed } = await newEvent()
    const { event: assigned } = await newEvent({ amount: 100000 })

    expect((await dismiss(dismissed.id, 'Đã xử lý lần 1')).error).toBeNull()
    expect((await assign(assigned.id, order.id)).error).toBeNull()
    expect(await reviewAudit(dismissed.id)).toHaveLength(1)
    expect(await reviewAudit(assigned.id)).toHaveLength(1)
    const before = await reviewAuditTotal()

    expect((await dismiss(dismissed.id, 'Đã xử lý lần 2')).error?.message).toMatch(
      /Không tìm thấy giao dịch cần xử lý/,
    )
    expect((await assign(dismissed.id, order.id)).error?.message).toMatch(
      /không còn ở trạng thái chưa khớp/,
    )
    expect((await assign(assigned.id, order.id)).error?.message).toMatch(
      /không còn ở trạng thái chưa khớp/,
    )
    expect((await dismiss(assigned.id, 'Đã xử lý lần 2')).error?.message).toMatch(
      /Không tìm thấy giao dịch cần xử lý/,
    )

    expect(await reviewAuditTotal()).toBe(before)
    expect((await eventRow(dismissed.id)).note).toBe('Đã xử lý lần 1')
    expect(await paidAmount(order.id)).toBe(100000) // credited once
  })

  it('two concurrent dismissals give one decision and one audit row', async () => {
    const { event } = await newEvent()
    const results = await Promise.all([dismiss(event.id, 'Lần một'), dismiss(event.id, 'Lần hai')])
    expect(results.filter((r) => r.error === null)).toHaveLength(1)

    const rows = await reviewAudit(event.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe((await eventRow(event.id)).note) // the winner's note
  })

  it('two concurrent assignments credit once and give one audit row', async () => {
    const order = await submittedOrder()
    const { event } = await newEvent({ amount: 100000 })
    const results = await Promise.all([assign(event.id, order.id), assign(event.id, order.id)])
    expect(results.filter((r) => r.error === null)).toHaveLength(1)

    expect(await reviewAudit(event.id)).toHaveLength(1)
    expect(await paidAmount(order.id)).toBe(100000)
  })
})

describe('audit rows and the event guard stay protected', () => {
  it('audit rows cannot be edited or deleted; the payload stays immutable', async () => {
    const { event } = await newEvent()
    expect((await dismiss(event.id, 'Đã xử lý')).error).toBeNull()
    const [row] = await reviewAudit(event.id)

    for (const client of [admin, sale]) {
      const upd = await client
        .from('audit_logs')
        .update({ reason: 'sửa' })
        .eq('id', row.id)
        .select()
      expect(upd.error !== null || (upd.data ?? []).length === 0).toBe(true)
      const del = await client.from('audit_logs').delete().eq('id', row.id).select()
      expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    }
    expect(
      (await svc().from('audit_logs').update({ before_data: {} }).eq('id', row.id)).error?.message,
    ).toMatch(/bất biến/)
    expect((await svc().from('audit_logs').delete().eq('id', row.id)).error?.message).toMatch(
      /bất biến/,
    )

    // The existing event guard is untouched, and its refusals are not decisions.
    const total = await reviewAuditTotal()
    const tamper = await svc().from('payment_events').update({ payload: {} }).eq('id', event.id)
    expect(tamper.error?.message).toMatch(/không được sửa nội dung gốc/)
    const remove = await svc().from('payment_events').delete().eq('id', event.id)
    expect(remove.error?.message).toMatch(/Không được xóa/)
    expect(await reviewAuditTotal()).toBe(total)
    expect(await reviewAudit(event.id)).toEqual([row])
  })

  it('only Admin can read the review audit', async () => {
    const { event } = await newEvent()
    expect((await dismiss(event.id, 'Đã xử lý')).error).toBeNull()
    expect(
      (await admin.from('audit_logs').select('id').eq('entity_id', event.id)).data ?? [],
    ).toHaveLength(1)
    expect(
      (await sale.from('audit_logs').select('id').eq('entity_id', event.id)).data ?? [],
    ).toHaveLength(0)
  })
})

describe('system outcomes are not Admin decisions', () => {
  const sepayId = () => Math.floor(Math.random() * 1e12) + 1e12
  const webhook = (payload: Record<string, unknown>) =>
    svc().rpc('process_sepay_webhook', { p_payload: payload as never })

  it('webhook processing writes no review audit; a later Admin decision does', async () => {
    const base = () => ({
      id: sepayId(),
      gateway: 'MBBank',
      transactionDate: '2026-10-05 10:20:30',
      accountNumber: '0123456789',
      code: null,
      content: 'khong co ma',
      transferType: 'in',
      transferAmount: 50000,
    })
    const unmatched = base()
    const before = await reviewAuditTotal()

    const received = [
      [unmatched, 'UNMATCHED'],
      [unmatched, 'DUPLICATE'], // a retried delivery
      [{ ...base(), accountNumber: '9999999999' }, 'NEEDS_REVIEW'],
      [{ ...base(), transferType: 'out' }, 'IGNORED'],
    ] as const
    for (const [payload, status] of received) {
      const { data, error } = await webhook(payload)
      expect(error).toBeNull()
      expect(data).toMatchObject({ status })
    }
    expect(await reviewAuditTotal()).toBe(before)

    const { data: row } = await svc()
      .from('payment_events')
      .select('id, note')
      .eq('provider_event_id', String(unmatched.id))
      .single()
    expect((await dismiss(row?.id, 'Khách chuyển nhầm, đã hoàn tiền')).error).toBeNull()
    const [audit, ...rest] = await reviewAudit(row?.id)
    expect(rest).toEqual([])
    expect(audit).toMatchObject({ action: 'review_dismiss', actor_user_id: adminId })
    expect(audit.before_data).toMatchObject({ outcome: 'UNMATCHED', note: row?.note })
    expect(await reviewAuditTotal()).toBe(before + 1)
  })
})
