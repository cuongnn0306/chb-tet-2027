/* eslint-disable @typescript-eslint/no-explicit-any -- RPC results are dynamic JSON; the tests assert on their shape */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { ROLE_CODES } from '@/domain/auth/roles'
import { canRequestReturn } from '@/domain/returns/request'
import { describeDbError } from '@/lib/db-errors'
import type { AppSupabaseClient } from '@/lib/supabase'
import { createReturnService, type ReturnService } from '@/services/returns.service'
import type { Database } from '@/types/database.generated'
import { TEST_PASSWORD, TEST_USERS, anonClient, getLocalConfig, serviceClient } from './helpers'

/**
 * RET-001: return request (REQUESTED stage only). These tests need the local Supabase stack with the
 * 20261006052000 migration applied; they were written without being run (the Docker DB is blocked in the
 * authoring environment), see the task report.
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

const rpc = (client: unknown, fn: string, args: Record<string, unknown> = {}) =>
  (
    client as {
      rpc: (f: string, a: unknown) => PromiseLike<{ data: any; error: any }>
    }
  ).rpc(fn, args)

/** The new tables are not in the generated types until `task:finish --generate-types` runs: stay untyped here. */
const table = (client: unknown, name: string) => (client as { from: (t: string) => any }).from(name)

type UserKey = keyof typeof TEST_USERS
const clients = {} as Record<UserKey, AppSupabaseClient>
const services = {} as Record<UserKey, ReturnService>
let customer: string
let adminId: string

const svc = () => serviceClient()

beforeAll(async () => {
  const keys = Object.keys(TEST_USERS) as UserKey[]
  const signedIn = await Promise.all(keys.map((key) => clientFor(TEST_USERS[key])))
  keys.forEach((key, index) => {
    clients[key] = signedIn[index]
    services[key] = createReturnService(signedIn[index])
  })
  const { data } = await clients.admin.auth.getUser()
  adminId = data.user?.id as string

  const found = await svc()
    .from('customers')
    .select('id')
    .eq('phone_normalized', '0900000003')
    .single()
  customer = found.data?.id as string
})

interface Fixture {
  orderId: string
  /** order_items.id by position of the `lines` argument. */
  itemIds: string[]
  productIds: string[]
}

/**
 * An order with one line per entry of `lines` (`quantity` ordered, `delivered` delivered), walked through the
 * approved state machine up to `status` (COMPLETED by default). Everything but the draft itself is the service
 * role standing in for the delivery / payment flows, which have their own tests.
 */
async function order(
  lines: { quantity: number; delivered: number }[] = [{ quantity: 10, delivered: 10 }],
  status: 'COMPLETED' | 'WAITING_DELIVERY' = 'COMPLETED',
): Promise<Fixture> {
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data: location } = await svc()
    .from('locations')
    .insert({
      code: `RET-${tag}`,
      name: `Cửa hàng trả hàng ${tag}`,
      location_type: 'STORE',
      region: 'HN',
      is_active: true,
    })
    .select('id')
    .single()

  const productIds: string[] = []
  for (const [index] of lines.entries()) {
    const { data: product, error } = await svc()
      .from('products')
      .insert({
        sku: `P-RET-${index}-${tag}`,
        name: `Bánh trả hàng ${index} ${tag}`,
        list_price: 100000,
        default_commission_rate: 0,
        is_active: true,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    productIds.push(product?.id as string)
  }

  const draft = await rpc(clients.sale, 'save_draft_order', {
    p_order_id: null,
    p_customer_id: customer,
    p_items: lines.map((line, index) => ({
      product_id: productIds[index],
      quantity: line.quantity,
    })),
    p_discount_amount: 0,
    p_creation_location_id: location?.id,
  })
  expect(draft.error).toBeNull()
  const orderId = draft.data.id as string
  const submit = await rpc(clients.sale, 'transition_order', {
    p_order_id: orderId,
    p_action: 'submit',
    p_reason: null,
  })
  expect(submit.error).toBeNull()

  const { data: rows } = await svc()
    .from('order_items')
    .select('id, product_id')
    .eq('order_id', orderId)
  const itemIds = productIds.map(
    (productId) => rows?.find((row) => row.product_id === productId)?.id as string,
  )
  for (const [index, line] of lines.entries()) {
    const { error } = await svc()
      .from('order_items')
      .update({ delivered_quantity: line.delivered })
      .eq('id', itemIds[index])
    expect(error).toBeNull()
  }

  const chain =
    status === 'COMPLETED'
      ? ['WAITING_DEPOSIT', 'CONFIRMED', 'RESERVED', 'PREPARING', 'WAITING_DELIVERY', 'COMPLETED']
      : ['WAITING_DEPOSIT', 'CONFIRMED', 'RESERVED', 'PREPARING', 'WAITING_DELIVERY']
  for (const next of chain) {
    const { error } = await svc().from('orders').update({ status: next }).eq('id', orderId)
    expect(error).toBeNull()
  }
  return { orderId, itemIds, productIds }
}

const ask = (
  client: unknown,
  orderId: string,
  items: unknown,
  reason: string | null = 'Khách báo bánh bị móp khi nhận',
) => rpc(client, 'request_return', { p_order_id: orderId, p_items: items, p_reason: reason })

const line = (orderItemId: string, quantity: unknown) => ({ order_item_id: orderItemId, quantity })

async function count(name: string, filter?: [string, string]) {
  let query = svc().from(name).select('*', { count: 'exact', head: true })
  if (filter) query = query.eq(filter[0], filter[1])
  const { count: n, error } = await query
  expect(error).toBeNull()
  return n
}

/** Everything a request must leave alone. Files run one at a time, so these counts are stable. */
async function ledgerAndMoney() {
  return {
    movements: await count('inventory_movements'),
    balances: await count('inventory_balances'),
    reservations: await count('inventory_reservations'),
    payments: await count('payments'),
    orders: await count('orders'),
    history: await count('order_status_history'),
  }
}

const requestedSum = async (itemId: string) => {
  const { data } = await svc().from('return_items').select('quantity').eq('order_item_id', itemId)
  return (data ?? []).reduce((sum, row) => sum + row.quantity, 0)
}

describe('permission: only the Admin may request a return', () => {
  it('the domain helper agrees: ADMIN only, no matrix entry exists for other roles', () => {
    expect(ROLE_CODES.filter(canRequestReturn)).toEqual(['ADMIN'])
  })

  const DENIED: UserKey[] = ['sale', 'store', 'franchise', 'warehouse', 'production', 'inactive']

  it.each(DENIED)('%s is refused with 42501 and nothing is created', async (key) => {
    const fixture = await order()
    const attempt = services[key].request({
      orderId: fixture.orderId,
      lines: [{ orderItemId: fixture.itemIds[0], quantity: 1 }],
      reason: 'Thử tạo yêu cầu trả hàng',
    })
    await expect(attempt).rejects.toMatchObject({ code: '42501' })
    expect(await count('returns', ['order_id', fixture.orderId])).toBe(0)
  })

  it('the Admin can', async () => {
    const fixture = await order()
    const created = await services.admin.request({
      orderId: fixture.orderId,
      lines: [{ orderItemId: fixture.itemIds[0], quantity: 1 }],
      reason: 'Admin tạo yêu cầu',
    })
    expect(created.status).toBe('REQUESTED')
  })

  it('nobody signed in can request or read', async () => {
    const fixture = await order()
    const anon = anonClient()
    const called = await ask(anon, fixture.orderId, [line(fixture.itemIds[0], 1)])
    expect(called.error?.code).toBe('42501')
    expect((await table(anon, 'returns').select('id')).error?.code).toBe('42501')
    expect((await table(anon, 'return_items').select('id')).error?.code).toBe('42501')
  })
})

describe('request through the typed service', () => {
  it('creates a REQUESTED return with its lines, taking the product from the order line', async () => {
    const fixture = await order([
      { quantity: 10, delivered: 10 },
      { quantity: 4, delivered: 4 },
    ])
    const created = await services.admin.request({
      orderId: fixture.orderId,
      lines: [
        { orderItemId: fixture.itemIds[0], quantity: 3 },
        { orderItemId: fixture.itemIds[1], quantity: 4 },
      ],
      reason: '  Khách đổi ý, hàng còn nguyên  ',
    })
    expect(created.status).toBe('REQUESTED')
    expect(created.return_code).toMatch(/^RET-\d{6,}$/)
    expect(created.reason).toBe('Khách đổi ý, hàng còn nguyên')
    expect(created.order_id).toBe(fixture.orderId)
    expect(created.created_by).toBe(adminId)
    expect(created.inspected_by).toBeNull()
    expect(created.inspected_at).toBeNull()
    expect(created.items).toHaveLength(2)
    expect(created.items.map((item) => item.quantity).sort()).toEqual([3, 4])
    const byItem = new Map(created.items.map((item) => [item.order_item_id, item]))
    expect(byItem.get(fixture.itemIds[0])?.product_id).toBe(fixture.productIds[0])
    expect(byItem.get(fixture.itemIds[1])?.product_id).toBe(fixture.productIds[1])

    const detail = await services.admin.get(created.id)
    expect(detail?.return_code).toBe(created.return_code)
    expect(detail?.orders?.order_code).toBeTruthy()
    expect(detail?.creator?.full_name).toBeTruthy()
    expect(detail?.return_items).toHaveLength(2)
    expect(detail?.return_items[0].products?.sku).toMatch(/^P-RET-/)

    const forOrder = await services.admin.listForOrder(fixture.orderId)
    expect(forOrder.map((row) => row.id)).toEqual([created.id])
  })

  it('stores no batch, no inspection result and no inspector yet', async () => {
    const fixture = await order()
    const created = await services.admin.request({
      orderId: fixture.orderId,
      lines: [{ orderItemId: fixture.itemIds[0], quantity: 2 }],
      reason: 'Kiểm tra trường mặc định',
    })
    const { data, error } = await svc()
      .from('return_items')
      .select('batch_id, inspection_result')
      .eq('return_id', created.id)
    expect(error).toBeNull()
    expect(data).toEqual([{ batch_id: null, inspection_result: null }])
  })

  it('shows what can still be returned to the request form', async () => {
    const fixture = await order([{ quantity: 10, delivered: 8 }])
    await services.admin.request({
      orderId: fixture.orderId,
      lines: [{ orderItemId: fixture.itemIds[0], quantity: 3 }],
      reason: 'Đã trả một phần',
    })
    const view = await services.admin.returnableOrder(fixture.orderId)
    expect(view?.status).toBe('COMPLETED')
    expect(view?.lines).toHaveLength(1)
    expect(view?.lines[0]).toMatchObject({
      orderedQuantity: 10,
      deliveredQuantity: 8,
      returnedQuantity: 0,
      requestedQuantity: 3,
      returnable: 5,
    })
    expect(await services.admin.returnableOrder(randomUUID())).toBeNull()
  })

  it('refuses invalid input before calling the database', async () => {
    const fixture = await order()
    await expect(
      services.admin.request({
        orderId: fixture.orderId,
        lines: [{ orderItemId: fixture.itemIds[0], quantity: 1 }],
        reason: '   ',
      }),
    ).rejects.toThrow(/chưa hợp lệ/)
    expect(await count('returns', ['order_id', fixture.orderId])).toBe(0)
  })
})

describe('what can be returned (server-side rules, through the raw RPC)', () => {
  it('maps every rule failure to an actionable Vietnamese message', async () => {
    const fixture = await order([
      { quantity: 10, delivered: 10 },
      { quantity: 5, delivered: 0 },
    ])
    const other = await order()
    const [delivered, notDelivered] = fixture.itemIds
    const admin = clients.admin

    const cases: [Awaited<ReturnType<typeof ask>>, RegExp][] = [
      [
        await ask(admin, fixture.orderId, [line(delivered, 0)]),
        /Số lượng trả phải là số nguyên lớn hơn 0/,
      ],
      [
        await ask(admin, fixture.orderId, [line(delivered, -3)]),
        /Số lượng trả phải là số nguyên lớn hơn 0/,
      ],
      [
        await ask(admin, fixture.orderId, [line(delivered, 2.5)]),
        /Số lượng trả phải là số nguyên lớn hơn 0/,
      ],
      [
        await ask(admin, fixture.orderId, [line(delivered, '5')]),
        /Số lượng trả phải là số nguyên lớn hơn 0/,
      ],
      [
        await ask(admin, fixture.orderId, [line(delivered, null)]),
        /Số lượng trả phải là số nguyên lớn hơn 0/,
      ],
      [
        await ask(admin, fixture.orderId, [{ order_item_id: 'not-a-uuid', quantity: 1 }]),
        /Dòng sản phẩm không hợp lệ/,
      ],
      [await ask(admin, fixture.orderId, []), /ít nhất một sản phẩm/],
      [await ask(admin, fixture.orderId, 'abc'), /ít nhất một sản phẩm/],
      [await ask(admin, fixture.orderId, [line(delivered, 1)], '   '), /lý do/],
      [await ask(admin, fixture.orderId, [line(delivered, 1)], null), /lý do/],
      [await ask(admin, fixture.orderId, [line(delivered, 1)], 'a'.repeat(501)), /tối đa 500/],
      [await ask(admin, fixture.orderId, [line(delivered, 1), line(delivered, 2)]), /một lần/],
      [
        await ask(
          admin,
          fixture.orderId,
          Array.from({ length: 51 }, () => line(randomUUID(), 1)),
        ),
        /tối đa 50/,
      ],
      [await ask(admin, null as unknown as string, [line(delivered, 1)]), /chọn đơn hàng/],
      [await ask(admin, randomUUID(), [line(delivered, 1)]), /Đơn hàng không tồn tại/],
      [await ask(admin, fixture.orderId, [line(randomUUID(), 1)]), /không thuộc đơn hàng này/],
      [await ask(admin, fixture.orderId, [line(other.itemIds[0], 1)]), /không thuộc đơn hàng này/],
      [await ask(admin, fixture.orderId, [line(notDelivered, 1)]), /chưa được giao/],
      [await ask(admin, fixture.orderId, [line(delivered, 11)]), /chỉ còn có thể trả tối đa 10/],
    ]
    for (const [result, message] of cases) {
      expect(result.error?.code).toBe('P0001')
      expect(describeDbError(result.error)).toMatch(message)
    }
    expect(await count('returns', ['order_id', fixture.orderId])).toBe(0)
    expect(await count('returns', ['order_id', other.orderId])).toBe(0)
  })

  it('only a COMPLETED order can be returned', async () => {
    const early = await order([{ quantity: 10, delivered: 4 }], 'WAITING_DELIVERY')
    const result = await ask(clients.admin, early.orderId, [line(early.itemIds[0], 1)])
    expect(result.error?.code).toBe('P0001')
    expect(describeDbError(result.error)).toMatch(
      /Chỉ tạo được yêu cầu trả hàng cho đơn đã hoàn tất/,
    )
    expect(result.error?.message).toMatch(/WAITING_DELIVERY/)
    expect(await count('returns', ['order_id', early.orderId])).toBe(0)
  })

  it('the cap is cumulative over every request of the same line', async () => {
    const fixture = await order([{ quantity: 10, delivered: 10 }])
    const item = fixture.itemIds[0]
    expect((await ask(clients.admin, fixture.orderId, [line(item, 4)])).error).toBeNull()
    expect((await ask(clients.admin, fixture.orderId, [line(item, 6)])).error).toBeNull()
    expect(await requestedSum(item)).toBe(10)

    const more = await ask(clients.admin, fixture.orderId, [line(item, 1)])
    expect(more.error?.code).toBe('P0001')
    expect(describeDbError(more.error)).toMatch(/chỉ còn có thể trả tối đa 0 \(đã giao 10/)
    expect(await requestedSum(item)).toBe(10)
  })

  it('a single request cannot exceed what is left after earlier requests', async () => {
    const fixture = await order([{ quantity: 10, delivered: 10 }])
    const item = fixture.itemIds[0]
    expect((await ask(clients.admin, fixture.orderId, [line(item, 7)])).error).toBeNull()
    const over = await ask(clients.admin, fixture.orderId, [line(item, 4)])
    expect(describeDbError(over.error)).toMatch(/chỉ còn có thể trả tối đa 3/)
    expect((await ask(clients.admin, fixture.orderId, [line(item, 3)])).error).toBeNull()
  })

  it('counts goods that were already returned (returned_quantity) and does not double count a request', async () => {
    const fixture = await order([{ quantity: 10, delivered: 10 }])
    const item = fixture.itemIds[0]
    await svc().from('order_items').update({ returned_quantity: 3 }).eq('id', item)
    const over = await ask(clients.admin, fixture.orderId, [line(item, 8)])
    expect(describeDbError(over.error)).toMatch(/chỉ còn có thể trả tối đa 7/)
    expect((await ask(clients.admin, fixture.orderId, [line(item, 7)])).error).toBeNull()

    // A later task copies the request into returned_quantity: the 7 requested units must not count twice.
    await svc().from('order_items').update({ returned_quantity: 10 }).eq('id', item)
    const none = await ask(clients.admin, fixture.orderId, [line(item, 1)])
    expect(describeDbError(none.error)).toMatch(/chỉ còn có thể trả tối đa 0/)
  })

  it('a partly delivered line can only return what was delivered', async () => {
    const fixture = await order([{ quantity: 10, delivered: 6 }])
    const item = fixture.itemIds[0]
    const over = await ask(clients.admin, fixture.orderId, [line(item, 7)])
    expect(describeDbError(over.error)).toMatch(/chỉ còn có thể trả tối đa 6 \(đã giao 6/)
    expect((await ask(clients.admin, fixture.orderId, [line(item, 6)])).error).toBeNull()
  })

  it('is atomic: one bad line leaves no return and no line behind', async () => {
    const fixture = await order([
      { quantity: 10, delivered: 10 },
      { quantity: 3, delivered: 3 },
    ])
    const result = await ask(clients.admin, fixture.orderId, [
      line(fixture.itemIds[0], 5),
      line(fixture.itemIds[1], 4),
    ])
    expect(result.error?.code).toBe('P0001')
    expect(await count('returns', ['order_id', fixture.orderId])).toBe(0)
    expect(await requestedSum(fixture.itemIds[0])).toBe(0)
    expect(await requestedSum(fixture.itemIds[1])).toBe(0)
  })
})

describe('a request moves no stock, money or order state', () => {
  it('leaves the ledger, balances, reservations, payments, order and counters untouched', async () => {
    const fixture = await order([{ quantity: 10, delivered: 10 }])
    const before = await ledgerAndMoney()
    const orderBefore = await svc()
      .from('orders')
      .select('status, gross_amount, discount_amount, net_amount, paid_amount, remaining_amount')
      .eq('id', fixture.orderId)
      .single()
    const itemBefore = await svc()
      .from('order_items')
      .select('quantity, allocated_quantity, delivered_quantity, returned_quantity')
      .eq('id', fixture.itemIds[0])
      .single()

    const created = await services.admin.request({
      orderId: fixture.orderId,
      lines: [{ orderItemId: fixture.itemIds[0], quantity: 10 }],
      reason: 'Trả toàn bộ để kiểm tra không có tác dụng phụ',
    })
    expect(created.status).toBe('REQUESTED')

    // Includes the order status history: a request writes no order transition.
    expect(await ledgerAndMoney()).toEqual(before)
    const orderAfter = await svc()
      .from('orders')
      .select('status, gross_amount, discount_amount, net_amount, paid_amount, remaining_amount')
      .eq('id', fixture.orderId)
      .single()
    expect(orderAfter.data).toEqual(orderBefore.data)
    // Open product decision: TECH_DESIGN §6 "COMPLETED -> RETURNED" is NOT performed by a request.
    expect(orderAfter.data?.status).toBe('COMPLETED')
    const itemAfter = await svc()
      .from('order_items')
      .select('quantity, allocated_quantity, delivered_quantity, returned_quantity')
      .eq('id', fixture.itemIds[0])
      .single()
    expect(itemAfter.data).toEqual(itemBefore.data)

    const check = await rpc(clients.admin, 'verify_inventory_balances')
    expect(check.error).toBeNull()
    expect(check.data).toEqual([])
  })
})

describe('access (RLS) and direct writes', () => {
  it('only the Admin reads returns and their lines', async () => {
    const fixture = await order()
    const created = await services.admin.request({
      orderId: fixture.orderId,
      lines: [{ orderItemId: fixture.itemIds[0], quantity: 2 }],
      reason: 'Kiểm tra quyền đọc',
    })
    expect(await services.admin.get(created.id)).not.toBeNull()

    for (const key of [
      'sale',
      'store',
      'franchise',
      'warehouse',
      'production',
      'inactive',
    ] as const) {
      expect(await services[key].get(created.id), key).toBeNull()
      expect(await services[key].listForOrder(fixture.orderId), key).toEqual([])
      const lines = await table(clients[key], 'return_items')
        .select('id')
        .eq('return_id', created.id)
      expect(lines.error, key).toBeNull()
      expect(lines.data, key).toEqual([])
    }
  })

  it('clients cannot write the tables directly (no self-service, no edits, no deletes)', async () => {
    const fixture = await order()
    const created = await services.admin.request({
      orderId: fixture.orderId,
      lines: [{ orderItemId: fixture.itemIds[0], quantity: 2 }],
      reason: 'Kiểm tra ghi trực tiếp',
    })

    for (const client of [clients.sale, clients.warehouse, clients.admin]) {
      const insert = await table(client, 'returns').insert({
        return_code: 'RET-HACK',
        order_id: fixture.orderId,
        reason: 'direct',
        created_by: adminId,
      })
      expect(insert.error?.code).toBe('42501')
      const status = await table(client, 'returns')
        .update({ status: 'RECEIVED_PENDING_INSPECTION' })
        .eq('id', created.id)
      expect(status.error?.code).toBe('42501')
      expect((await table(client, 'returns').delete().eq('id', created.id)).error?.code).toBe(
        '42501',
      )
      const line = await table(client, 'return_items').insert({
        return_id: created.id,
        order_item_id: fixture.itemIds[0],
        product_id: fixture.productIds[0],
        quantity: 1,
      })
      expect(line.error?.code).toBe('42501')
      const edit = await table(client, 'return_items')
        .update({ quantity: 9 })
        .eq('return_id', created.id)
      expect(edit.error?.code).toBe('42501')
    }
    const still = await services.admin.get(created.id)
    expect(still?.status).toBe('REQUESTED')
    expect(still?.return_items[0].quantity).toBe(2)
  })

  it('even the service role cannot skip a state, edit a frozen field or delete', async () => {
    const fixture = await order()
    const created = await services.admin.request({
      orderId: fixture.orderId,
      lines: [{ orderItemId: fixture.itemIds[0], quantity: 2 }],
      reason: 'Kiểm tra trạng thái',
    })
    for (const target of ['RESTOCKED', 'DAMAGED', 'CLOSED']) {
      const skip = await svc().from('returns').update({ status: target }).eq('id', created.id)
      expect(skip.error?.message, target).toMatch(
        new RegExp(`Không thể chuyển yêu cầu trả hàng từ REQUESTED sang ${target}`),
      )
    }
    const reason = await svc().from('returns').update({ reason: 'edited' }).eq('id', created.id)
    expect(reason.error?.message).toMatch(/Không được đổi/)
    const code = await svc().from('returns').update({ return_code: 'RET-X' }).eq('id', created.id)
    expect(code.error?.message).toMatch(/Không được đổi/)
    const qty = await svc().from('return_items').update({ quantity: 1 }).eq('return_id', created.id)
    expect(qty.error?.message).toMatch(/Không được đổi/)
    expect((await svc().from('returns').delete().eq('id', created.id)).error?.message).toMatch(
      /Không được xóa/,
    )
    expect(
      (await svc().from('return_items').delete().eq('return_id', created.id)).error?.message,
    ).toMatch(/Không được xóa/)

    const row = await svc().from('returns').select('status, reason').eq('id', created.id).single()
    expect(row.data).toEqual({ status: 'REQUESTED', reason: created.reason })
  })

  it('the guard is a backstop for direct inserts: wrong status, wrong order state, wrong product, over the cap', async () => {
    const fixture = await order([{ quantity: 10, delivered: 10 }])
    const early = await order([{ quantity: 10, delivered: 4 }], 'WAITING_DELIVERY')

    const born = await svc().from('returns').insert({
      return_code: 'x',
      order_id: fixture.orderId,
      reason: 'r',
      created_by: adminId,
      status: 'CLOSED',
    })
    expect(born.error?.message).toMatch(/phải ở trạng thái REQUESTED/)

    const notDone = await svc()
      .from('returns')
      .insert({ return_code: 'x', order_id: early.orderId, reason: 'r', created_by: adminId })
    expect(notDone.error?.message).toMatch(/đơn đã hoàn tất/)

    const parent = await svc()
      .from('returns')
      .insert({
        return_code: 'ignored',
        order_id: fixture.orderId,
        reason: 'r',
        created_by: adminId,
      })
      .select('id, return_code')
      .single()
    expect(parent.error).toBeNull()
    expect(parent.data?.return_code).toMatch(/^RET-\d{6,}$/)
    expect(parent.data?.return_code).not.toBe('ignored')
    const returnId = parent.data?.id as string

    const wrongProduct = await svc().from('return_items').insert({
      return_id: returnId,
      order_item_id: fixture.itemIds[0],
      product_id: early.productIds[0],
      quantity: 1,
    })
    expect(wrongProduct.error?.message).toMatch(/phải trùng với sản phẩm/)

    const foreignLine = await svc().from('return_items').insert({
      return_id: returnId,
      order_item_id: early.itemIds[0],
      product_id: early.productIds[0],
      quantity: 1,
    })
    expect(foreignLine.error?.message).toMatch(/không thuộc đơn hàng/)

    const over = await svc().from('return_items').insert({
      return_id: returnId,
      order_item_id: fixture.itemIds[0],
      product_id: fixture.productIds[0],
      quantity: 11,
    })
    expect(over.error?.message).toMatch(/vượt quá số lượng đã giao/)

    const fine = await svc().from('return_items').insert({
      return_id: returnId,
      order_item_id: fixture.itemIds[0],
      product_id: fixture.productIds[0],
      quantity: 10,
    })
    expect(fine.error).toBeNull()
    const again = await svc().from('return_items').insert({
      return_id: returnId,
      order_item_id: fixture.itemIds[0],
      product_id: fixture.productIds[0],
      quantity: 1,
    })
    expect(again.error).not.toBeNull()
  })

  it('writes audit entries attributed to the Admin, with the reason', async () => {
    const fixture = await order([
      { quantity: 5, delivered: 5 },
      { quantity: 5, delivered: 5 },
    ])
    const created = await services.admin.request({
      orderId: fixture.orderId,
      lines: [
        { orderItemId: fixture.itemIds[0], quantity: 1 },
        { orderItemId: fixture.itemIds[1], quantity: 2 },
      ],
      reason: 'Kiểm tra audit',
    })
    const header = await svc()
      .from('audit_logs')
      .select('actor_user_id, action, reason, after_data')
      .eq('entity_type', 'returns')
      .eq('entity_id', created.id)
    expect(header.error).toBeNull()
    expect(header.data).toHaveLength(1)
    expect(header.data?.[0]).toMatchObject({
      actor_user_id: adminId,
      action: 'insert',
      reason: 'Yêu cầu trả hàng',
    })
    expect((header.data?.[0].after_data as { status: string }).status).toBe('REQUESTED')

    const lines = await svc()
      .from('audit_logs')
      .select('actor_user_id, reason')
      .eq('entity_type', 'return_items')
      .in(
        'entity_id',
        created.items.map((item) => item.id),
      )
    expect(lines.error).toBeNull()
    expect(lines.data).toHaveLength(2)
    expect(
      lines.data?.every(
        (row) => row.actor_user_id === adminId && row.reason === 'Yêu cầu trả hàng',
      ),
    ).toBe(true)
  })
})

describe('concurrency', () => {
  it('parallel requests over one line never exceed the delivered quantity', async () => {
    const fixture = await order([{ quantity: 10, delivered: 10 }])
    const item = fixture.itemIds[0]
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ask(clients.admin, fixture.orderId, [line(item, 3)])),
    )
    const accepted = results.filter((result) => result.error === null)
    const refused = results.filter((result) => result.error !== null)
    expect(accepted).toHaveLength(3)
    expect(refused).toHaveLength(2)
    for (const result of refused) expect(result.error?.code).toBe('P0001')
    expect(await requestedSum(item)).toBe(9)

    const codes = accepted.map((result) => result.data.return_code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('parallel requests for different orders all succeed with distinct codes', async () => {
    const fixtures = await Promise.all(Array.from({ length: 4 }, () => order()))
    const results = await Promise.all(
      fixtures.map((fixture) => ask(clients.admin, fixture.orderId, [line(fixture.itemIds[0], 1)])),
    )
    for (const result of results) expect(result.error).toBeNull()
    const codes = results.map((result) => result.data.return_code)
    expect(new Set(codes).size).toBe(4)
  })
})
