/* eslint-disable @typescript-eslint/no-explicit-any -- RPC results are dynamic JSON; the tests assert on their shape */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { ROLE_CODES, hasPermission, type RoleCode } from '@/domain/auth/roles'
import { canProposeTransfer, type TransferRequestInput } from '@/domain/transfers/transfers'
import { describeDbError } from '@/lib/db-errors'
import type { AppSupabaseClient } from '@/lib/supabase'
import { createTransferService, type TransferService } from '@/services/transfers.service'
import type { Database } from '@/types/database.generated'
import { TEST_PASSWORD, TEST_USERS, anonClient, getLocalConfig, serviceClient } from './helpers'

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
const services = {} as Record<UserKey, TransferService>

let src: string
let dst: string
let closed: string
let p1: string
let p2: string
let retired: string

const svc = () => serviceClient()

beforeAll(async () => {
  const keys = Object.keys(TEST_USERS) as UserKey[]
  const signedIn = await Promise.all(keys.map((key) => clientFor(TEST_USERS[key])))
  keys.forEach((key, index) => {
    clients[key] = signedIn[index]
    services[key] = createTransferService(signedIn[index])
  })

  // Every row of a bulk insert states is_active: PostgREST sends NULL for keys that only some rows
  // have, which violates the NOT NULL column instead of using its DEFAULT.
  const tag = randomUUID().slice(0, 6).toUpperCase()
  const { data: locations, error: locationError } = await svc()
    .from('locations')
    .insert([
      {
        code: `TRI-S-${tag}`,
        name: `Kho xuất ${tag}`,
        location_type: 'STORE',
        region: 'HN',
        is_active: true,
      },
      {
        code: `TRI-D-${tag}`,
        name: `Kho nhận ${tag}`,
        location_type: 'STORE',
        region: 'HN',
        is_active: true,
      },
      {
        code: `TRI-X-${tag}`,
        name: `Kho đã đóng ${tag}`,
        location_type: 'STORE',
        region: 'HN',
        is_active: false,
      },
    ])
    .select('id, code')
  expect(locationError).toBeNull()
  const location = (prefix: string) =>
    (locations ?? []).find((row) => row.code.startsWith(prefix))?.id as string
  src = location('TRI-S-')
  dst = location('TRI-D-')
  closed = location('TRI-X-')

  const { data: products, error: productError } = await svc()
    .from('products')
    .insert([
      {
        sku: `P-TRI-P1-${tag}`,
        name: `Sản phẩm điều chuyển 1 ${tag}`,
        list_price: 1000,
        default_commission_rate: 0,
        is_active: true,
      },
      {
        sku: `P-TRI-P2-${tag}`,
        name: `Sản phẩm điều chuyển 2 ${tag}`,
        list_price: 1000,
        default_commission_rate: 0,
        is_active: true,
      },
      {
        sku: `P-TRI-PX-${tag}`,
        name: `Sản phẩm đã ngừng ${tag}`,
        list_price: 1000,
        default_commission_rate: 0,
        is_active: false,
      },
    ])
    .select('id, sku')
  expect(productError).toBeNull()
  const product = (prefix: string) =>
    (products ?? []).find((row) => row.sku.startsWith(prefix))?.id as string
  p1 = product('P-TRI-P1-')
  p2 = product('P-TRI-P2-')
  retired = product('P-TRI-PX-')
})

const input = (over: Partial<TransferRequestInput> = {}): TransferRequestInput => ({
  sourceLocationId: src,
  destinationLocationId: dst,
  lines: [{ productId: p1, quantity: 30 }],
  reason: 'Cửa hàng sắp hết hàng, cần thêm trước cuối tuần',
  ...over,
})

/** Everything a request must leave alone. Files run one at a time, so these counts are stable. */
async function ledgerAndRevenue() {
  const count = async (table: string) => {
    const { count: n, error } = await svc().from(table).select('*', { count: 'exact', head: true })
    expect(error).toBeNull()
    return n
  }
  return {
    movements: await count('inventory_movements'),
    balances: await count('inventory_balances'),
    reservations: await count('inventory_reservations'),
    orders: await count('orders'),
    payments: await count('payments'),
  }
}

describe('permission: propose_transfer', () => {
  it('the roles seed and PERMISSION_MATRIX grant it to the same roles', async () => {
    const { data, error } = await svc().from('roles').select('code, permissions')
    expect(error).toBeNull()
    const seeded = (data ?? [])
      .filter((row) => (row.permissions as Record<string, unknown>).propose_transfer !== undefined)
      .map((row) => row.code)
      .sort()
    const inCode = ROLE_CODES.filter((role) => hasPermission(role, 'propose_transfer')).sort()
    expect(seeded).toEqual(inCode)
    expect(inCode).toEqual(ROLE_CODES.filter(canProposeTransfer).sort())
  })

  const CASES: [UserKey, RoleCode][] = [
    ['admin', 'ADMIN'],
    ['sale', 'SALE_B2B'],
    ['store', 'STORE_STAFF'],
    ['franchise', 'FRANCHISE_STAFF'],
    ['warehouse', 'WAREHOUSE'],
    ['production', 'PRODUCTION'],
  ]

  it.each(CASES)('%s (%s): the database agrees with the permission matrix', async (key, role) => {
    const attempt = services[key].request(input())
    if (hasPermission(role, 'propose_transfer')) {
      const created = await attempt
      expect(created.status).toBe('REQUESTED')
      expect(created.transfer_code).toMatch(/^TR-\d{4,}$/)
    } else {
      await expect(attempt).rejects.toMatchObject({ code: '42501' })
    }
  })

  it('an inactive user cannot request, even though they can sign in', async () => {
    await expect(services.inactive.request(input())).rejects.toMatchObject({ code: '42501' })
  })

  it('nobody signed in can request or read', async () => {
    const anon = anonClient()
    const called = await rpc(anon, 'request_transfer', {
      p_source_location_id: src,
      p_destination_location_id: dst,
      p_items: [{ product_id: p1, quantity: 1 }],
      p_reason: 'anon',
    })
    expect(called.error?.code).toBe('42501')
    const read = await table(anon, 'transfers').select('id')
    expect(read.error?.code).toBe('42501')
  })
})

describe('request through the typed service', () => {
  it('creates a REQUESTED transfer the requester and the Admin can read', async () => {
    const created = await services.store.request(input({ reason: '  Store A sắp hết hàng  ' }))
    expect(created.status).toBe('REQUESTED')
    expect(created.reason).toBe('Store A sắp hết hàng')
    expect(created.source_location_id).toBe(src)
    expect(created.destination_location_id).toBe(dst)
    expect(created.items).toHaveLength(1)
    expect(created.items[0]).toMatchObject({ product_id: p1, requested_qty: 30 })

    const mine = await services.store.get(created.id)
    expect(mine).not.toBeNull()
    expect(mine?.transfer_code).toBe(created.transfer_code)
    expect(mine?.source?.name).toMatch(/^Kho xuất/)
    expect(mine?.destination?.name).toMatch(/^Kho nhận/)
    expect(mine?.requester?.full_name).toBeTruthy()
    expect(mine?.transfer_items).toHaveLength(1)
    expect(mine?.transfer_items[0]).toMatchObject({
      requested_qty: 30,
      approved_qty: 0,
      dispatched_qty: 0,
      received_qty: 0,
    })
    expect(mine?.transfer_items[0].products?.sku).toMatch(/^P-TRI-P1-/)

    const forAdmin = await services.admin.get(created.id)
    expect(forAdmin?.id).toBe(created.id)
    expect(forAdmin?.requester?.full_name).toBe(mine?.requester?.full_name)
  })

  it('lists newest first, filters by status, and shows the Admin queue', async () => {
    const created = await services.sale.request(input({ lines: [{ productId: p2, quantity: 7 }] }))

    const mine = await services.sale.list()
    expect(mine.map((row) => row.id)).toContain(created.id)
    expect(mine.every((row) => row.requested_by === mine[0].requested_by)).toBe(true)
    const times = mine.map((row) => Date.parse(row.created_at))
    expect(times).toEqual([...times].sort((a, b) => b - a))

    const queue = await services.admin.list({ status: 'REQUESTED' })
    expect(queue.map((row) => row.id)).toContain(created.id)
    expect(queue.every((row) => row.status === 'REQUESTED')).toBe(true)

    const approved = await services.admin.list({ status: 'APPROVED' })
    expect(approved.map((row) => row.id)).not.toContain(created.id)
  })

  it('accepts several distinct products in one request', async () => {
    const created = await services.store.request(
      input({
        lines: [
          { productId: p1, quantity: 2 },
          { productId: p2, quantity: 3 },
        ],
      }),
    )
    expect(created.items.map((item) => item.requested_qty).sort()).toEqual([2, 3])
  })

  it('refuses invalid input before calling the database', async () => {
    await expect(services.store.request(input({ destinationLocationId: src }))).rejects.toThrow(
      /chưa hợp lệ/,
    )
    await expect(
      services.store.request(input({ lines: [{ productId: p1, quantity: null }] })),
    ).rejects.toThrow(/chưa hợp lệ/)
  })

  it('maps database rule failures to actionable Vietnamese messages', async () => {
    const cases: [Partial<TransferRequestInput>, RegExp][] = [
      [{ sourceLocationId: closed }, /Kho xuất không tồn tại hoặc đã ngừng sử dụng/],
      [{ destinationLocationId: closed }, /Kho nhận không tồn tại hoặc đã ngừng sử dụng/],
      [
        { lines: [{ productId: retired, quantity: 1 }] },
        /Sản phẩm không tồn tại hoặc đã ngừng kinh doanh/,
      ],
    ]
    for (const [over, message] of cases) {
      const error = await services.store.request(input(over)).then(
        () => null,
        (e: unknown) => e as { code?: string; message?: string },
      )
      expect(error?.code).toBe('P0001')
      expect(describeDbError(error ?? {})).toMatch(message)
    }

    // The raw RPC reports the same rules (a client can skip our own validation).
    const raw = async (items: unknown, reason = 'x', source = src, destination = dst) =>
      rpc(clients.store, 'request_transfer', {
        p_source_location_id: source,
        p_destination_location_id: destination,
        p_items: items,
        p_reason: reason,
      })
    const rejected: [Awaited<ReturnType<typeof raw>>, RegExp][] = [
      [await raw([{ product_id: p1, quantity: 0 }]), /Số lượng phải là số nguyên lớn hơn 0/],
      [await raw([{ product_id: p1, quantity: -3 }]), /Số lượng phải là số nguyên lớn hơn 0/],
      [await raw([{ product_id: p1, quantity: 2.5 }]), /Số lượng phải là số nguyên lớn hơn 0/],
      [await raw([{ product_id: p1, quantity: '5' }]), /Số lượng phải là số nguyên lớn hơn 0/],
      [await raw([{ product_id: 'not-a-uuid', quantity: 1 }]), /Dòng sản phẩm không hợp lệ/],
      [await raw([]), /ít nhất một sản phẩm/],
      [await raw('abc'), /ít nhất một sản phẩm/],
      [await raw([{ product_id: p1, quantity: 1 }], '   '), /lý do/],
      [
        await raw([
          { product_id: p1, quantity: 1 },
          { product_id: p1, quantity: 2 },
        ]),
        /một lần/,
      ],
      [await raw([{ product_id: p1, quantity: 1 }], 'x', src, src), /khác nhau/],
      [
        await raw(Array.from({ length: 51 }, () => ({ product_id: randomUUID(), quantity: 1 }))),
        /tối đa 50/,
      ],
    ]
    for (const [result, message] of rejected) {
      expect(result.error?.code).toBe('P0001')
      expect(describeDbError(result.error)).toMatch(message)
    }
  })
})

describe('a request moves no stock and is not revenue', () => {
  it('leaves the ledger, balances, reservations, orders and payments untouched', async () => {
    const before = await ledgerAndRevenue()
    await services.store.request(input())
    await services.warehouse.request(input({ lines: [{ productId: p2, quantity: 12 }] }))
    await services.admin.request(input())
    expect(await ledgerAndRevenue()).toEqual(before)

    const check = await rpc(clients.admin, 'verify_inventory_balances')
    expect(check.error).toBeNull()
    expect(check.data).toEqual([])
  })

  it('creates no batch assignment', async () => {
    const created = await services.store.request(input())
    const { data, error } = await svc()
      .from('transfer_items')
      .select('batch_id, approved_qty, dispatched_qty, received_qty')
      .eq('transfer_id', created.id)
    expect(error).toBeNull()
    expect(data).toEqual([{ batch_id: null, approved_qty: 0, dispatched_qty: 0, received_qty: 0 }])
  })
})

describe('access (RLS) and direct writes', () => {
  it('a requester sees only their own requests', async () => {
    const mine = await services.store.request(input())
    const theirs = await services.sale.request(input())

    expect(await services.store.get(mine.id)).not.toBeNull()
    expect(await services.store.get(theirs.id)).toBeNull()
    expect(await services.sale.get(mine.id)).toBeNull()
    expect((await services.store.list()).map((row) => row.id)).not.toContain(theirs.id)
    expect((await services.sale.list()).map((row) => row.id)).not.toContain(mine.id)
  })

  it('the Admin sees every requester; Production and inactive users see nothing', async () => {
    const a = await services.store.request(input())
    const b = await services.franchise.request(input())
    const adminIds = (await services.admin.list()).map((row) => row.id)
    expect(adminIds).toContain(a.id)
    expect(adminIds).toContain(b.id)

    expect(await services.production.list()).toEqual([])
    expect(await services.production.get(a.id)).toBeNull()
    expect(await services.inactive.list()).toEqual([])
    expect(await services.inactive.get(a.id)).toBeNull()
  })

  it('lines follow their transfer: nobody reads another requester’s lines', async () => {
    const mine = await services.store.request(input())
    const { data, error } = await table(clients.sale, 'transfer_items')
      .select('id')
      .eq('transfer_id', mine.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('clients cannot write the tables directly (no self-approval, no edits, no deletes)', async () => {
    const mine = await services.store.request(input())

    for (const client of [clients.store, clients.admin]) {
      const insert = await table(client, 'transfers').insert({
        transfer_code: 'TR-HACK',
        requested_by: mine.requested_by,
        source_location_id: src,
        destination_location_id: dst,
        reason: 'direct',
      })
      expect(insert.error?.code).toBe('42501')

      const approve = await table(client, 'transfers')
        .update({ status: 'APPROVED' })
        .eq('id', mine.id)
      expect(approve.error?.code).toBe('42501')

      const remove = await table(client, 'transfers').delete().eq('id', mine.id)
      expect(remove.error?.code).toBe('42501')

      const line = await table(client, 'transfer_items').insert({
        transfer_id: mine.id,
        product_id: p2,
        requested_qty: 1,
      })
      expect(line.error?.code).toBe('42501')

      const edit = await table(client, 'transfer_items')
        .update({ requested_qty: 999 })
        .eq('transfer_id', mine.id)
      expect(edit.error?.code).toBe('42501')
    }

    const still = await services.store.get(mine.id)
    expect(still?.status).toBe('REQUESTED')
    expect(still?.transfer_items[0].requested_qty).toBe(30)
  })

  it('even the service role cannot skip a state or edit a frozen field', async () => {
    const created = await services.store.request(input())
    const skip = await svc().from('transfers').update({ status: 'RECEIVED' }).eq('id', created.id)
    expect(skip.error?.message).toMatch(
      /Không thể chuyển yêu cầu điều chuyển từ REQUESTED sang RECEIVED/,
    )
    const jump = await svc().from('transfers').update({ status: 'DISPATCHED' }).eq('id', created.id)
    expect(jump.error?.message).toMatch(/từ REQUESTED sang DISPATCHED/)
    const reason = await svc().from('transfers').update({ reason: 'edited' }).eq('id', created.id)
    expect(reason.error?.message).toMatch(/Không được đổi/)
    const qty = await svc()
      .from('transfer_items')
      .update({ requested_qty: 1 })
      .eq('transfer_id', created.id)
    expect(qty.error?.message).toMatch(/Không được đổi/)
    const del = await svc().from('transfers').delete().eq('id', created.id)
    expect(del.error?.message).toMatch(/Không được xóa/)

    const row = await svc().from('transfers').select('status, reason').eq('id', created.id).single()
    expect(row.data).toEqual({ status: 'REQUESTED', reason: created.reason })
  })

  it('writes an audit entry for the request, attributed to the requester', async () => {
    const created = await services.store.request(input())
    const { data, error } = await svc()
      .from('audit_logs')
      .select('actor_user_id, action, reason, after_data')
      .eq('entity_type', 'transfers')
      .eq('entity_id', created.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]).toMatchObject({
      actor_user_id: created.requested_by,
      action: 'insert',
      reason: 'Yêu cầu điều chuyển kho',
    })
    expect((data?.[0].after_data as { status: string }).status).toBe('REQUESTED')
  })
})

describe('concurrency', () => {
  it('parallel requests all succeed and get distinct codes', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        (index % 2 === 0 ? services.store : services.sale).request(
          input({ lines: [{ productId: p1, quantity: index + 1 }] }),
        ),
      ),
    )
    const codes = results.map((row) => row.transfer_code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(results.map((row) => row.items[0].requested_qty).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ])
  })
})
