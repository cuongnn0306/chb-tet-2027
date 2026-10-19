import { describe, expect, it, vi } from 'vitest'
import type { AccessState, ActiveUser } from '@/domain/auth/access'
import { ROLE_CODES, type RoleCode } from '@/domain/auth/roles'
import { resolveRecommendationQuery } from '@/domain/transfers/recommendations'
import { MAX_LINE_QUANTITY } from '@/domain/transfers/transfers'
import { describeDbError } from '@/lib/db-errors'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError } from '@/services/crud.service'
import { TransferInputError, createTransferService } from '@/services/transfers.service'

const SRC = '11111111-1111-4111-8111-111111111111'
const DST = '22222222-2222-4222-8222-222222222222'
const P1 = '33333333-3333-4333-8333-333333333333'

function row(id: string, code: string, extra: Record<string, unknown> = {}) {
  return {
    location_id: id,
    location_code: code,
    location_name: `Kho ${code}`,
    region: 'HCM',
    sellable_qty: 10,
    same_region: true,
    covers_all: true,
    earliest_expiry: '2027-01-31',
    ...extra,
  }
}

/** A client that only offers `rpc`: any other call (from, insert, update…) would throw and fail the test. */
function fakeClient(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result)
  return { client: { rpc } as unknown as AppSupabaseClient, rpc }
}

describe('suggestSources (TRF-002)', () => {
  it('calls the existing read RPC with exactly the typed arguments and nothing else', async () => {
    const { client, rpc } = fakeClient({ data: [], error: null })
    await createTransferService(client).suggestSources({
      productId: P1,
      destinationLocationId: DST,
      quantity: 30,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('suggest_transfer_sources', {
      p_product_id: P1,
      p_destination_location_id: DST,
      p_quantity: 30,
    })
  })

  it('keeps the order the database returned and does not re-rank, filter or sum', async () => {
    // Deliberately not in any order the client could produce itself (quantities and codes ascending / mixed).
    const data = [
      row('l-3', 'C-03', { sellable_qty: 1, same_region: true, covers_all: false }),
      row('l-1', 'A-01', { sellable_qty: 500, same_region: false, covers_all: true, region: null }),
      row('l-2', 'B-02', { sellable_qty: 40, same_region: false, covers_all: true }),
    ]
    const { client } = fakeClient({ data, error: null })
    const result = await createTransferService(client).suggestSources({
      productId: P1,
      destinationLocationId: DST,
      quantity: 30,
    })
    expect(result.map((r) => r.locationId)).toEqual(['l-3', 'l-1', 'l-2'])
    expect(result[0]).toEqual({
      locationId: 'l-3',
      locationCode: 'C-03',
      locationName: 'Kho C-03',
      region: 'HCM',
      sellableQty: 1,
      sameRegion: true,
      coversAll: false,
    })
    expect(result[1]).toMatchObject({ region: null, sellableQty: 500, coversAll: true })
  })

  it('does not expose batch-derived expiry to the screens', async () => {
    const { client } = fakeClient({ data: [row('l-1', 'A-01')], error: null })
    const [first] = await createTransferService(client).suggestSources({
      productId: P1,
      destinationLocationId: DST,
      quantity: 1,
    })
    expect(first).not.toHaveProperty('earliestExpiry')
    expect(first).not.toHaveProperty('earliest_expiry')
  })

  it('returns an empty list for no rows or null data', async () => {
    for (const data of [[], null]) {
      const { client } = fakeClient({ data, error: null })
      await expect(
        createTransferService(client).suggestSources({
          productId: P1,
          destinationLocationId: DST,
          quantity: 5,
        }),
      ).resolves.toEqual([])
    }
  })

  it.each([
    ['empty product', { productId: '', destinationLocationId: DST, quantity: 5 }],
    ['empty destination', { productId: P1, destinationLocationId: '', quantity: 5 }],
    ['zero', { productId: P1, destinationLocationId: DST, quantity: 0 }],
    ['negative', { productId: P1, destinationLocationId: DST, quantity: -3 }],
    ['fraction', { productId: P1, destinationLocationId: DST, quantity: 1.5 }],
    ['NaN', { productId: P1, destinationLocationId: DST, quantity: Number.NaN }],
    [
      'above the bound',
      { productId: P1, destinationLocationId: DST, quantity: MAX_LINE_QUANTITY + 1 },
    ],
  ])('makes no RPC call for invalid input (%s)', async (_label, query) => {
    const { client, rpc } = fakeClient({ data: [], error: null })
    await expect(createTransferService(client).suggestSources(query)).rejects.toBeInstanceOf(
      TransferInputError,
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('accepts the upper bound', async () => {
    const { client, rpc } = fakeClient({ data: [], error: null })
    await createTransferService(client).suggestSources({
      productId: P1,
      destinationLocationId: DST,
      quantity: MAX_LINE_QUANTITY,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('propagates a permission error (42501) as a DbError the UI maps to an actionable message', async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: '42501', message: 'Bạn không có quyền xem gợi ý chuyển kho.' },
    })
    const failure = await createTransferService(client)
      .suggestSources({ productId: P1, destinationLocationId: DST, quantity: 5 })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DbError)
    expect((failure as DbError).code).toBe('42501')
    expect(describeDbError(failure as DbError)).toBe('Bạn không có quyền thực hiện thao tác này.')
  })

  it('propagates other database errors unchanged', async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: 'P0001', message: 'Số lượng phải lớn hơn 0.' },
    })
    const failure = await createTransferService(client)
      .suggestSources({ productId: P1, destinationLocationId: DST, quantity: 5 })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DbError)
    expect(describeDbError(failure as DbError)).toBe('Số lượng phải lớn hơn 0.')
  })
})

describe('request payload is unchanged by TRF-002', () => {
  it('still sends the chosen source, destination, one line and the trimmed reason to request_transfer', async () => {
    const { client, rpc } = fakeClient({ data: { id: 't-1', items: [] }, error: null })
    await createTransferService(client).request({
      sourceLocationId: SRC,
      destinationLocationId: DST,
      lines: [{ productId: P1, quantity: 30 }],
      reason: '  Cửa hàng sắp hết hàng  ',
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('request_transfer', {
      p_source_location_id: SRC,
      p_destination_location_id: DST,
      p_items: [{ product_id: P1, quantity: 30 }],
      p_reason: 'Cửa hàng sắp hết hàng',
    })
  })
})

function active(roleCode: RoleCode, id = 'user-1'): AccessState {
  const user: ActiveUser = {
    id,
    fullName: 'Người dùng',
    isActive: true,
    roleCode,
    roleName: null,
    defaultLocationId: null,
    defaultSalesChannelId: null,
    defaultLeadSourceId: null,
  }
  return { status: 'active', user }
}

const form = { destinationLocationId: DST, productId: P1, quantityText: '30' }

describe('resolveRecommendationQuery (TRF-002 gating)', () => {
  it('returns the identity of the query for an active user with valid input', () => {
    expect(resolveRecommendationQuery(active('STORE_STAFF'), form)).toEqual({
      userId: 'user-1',
      roleCode: 'STORE_STAFF',
      destinationLocationId: DST,
      productId: P1,
      quantity: 30,
    })
  })

  it('asks for nothing unless the user is active', () => {
    const states: AccessState[] = [
      { status: 'loading' },
      { status: 'signed_out' },
      { status: 'no_profile' },
      { status: 'inactive', fullName: 'Người dùng' },
    ]
    for (const state of states) expect(resolveRecommendationQuery(state, form)).toBeNull()
  })

  it('asks for nothing for roles without propose_transfer (same set the RPC allows)', () => {
    const allowed = ROLE_CODES.filter((role) => resolveRecommendationQuery(active(role), form))
    expect([...allowed].sort()).toEqual(
      ['ADMIN', 'FRANCHISE_STAFF', 'SALE_B2B', 'STORE_STAFF', 'WAREHOUSE'].sort(),
    )
    expect(resolveRecommendationQuery(active('PRODUCTION'), form)).toBeNull()
  })

  it.each([
    ['no destination', { ...form, destinationLocationId: '' }],
    ['no product', { ...form, productId: '' }],
    ['empty quantity', { ...form, quantityText: '' }],
    ['zero', { ...form, quantityText: '0' }],
    ['decimal', { ...form, quantityText: '1.5' }],
    ['negative', { ...form, quantityText: '-4' }],
    ['text', { ...form, quantityText: 'abc' }],
    ['exponent', { ...form, quantityText: '1e3' }],
    ['too large', { ...form, quantityText: String(MAX_LINE_QUANTITY + 1) }],
  ])('asks for nothing for invalid input (%s)', (_label, input) => {
    expect(resolveRecommendationQuery(active('ADMIN'), input)).toBeNull()
  })

  it('gives a different identity per user, destination, product and quantity', () => {
    const base = resolveRecommendationQuery(active('ADMIN', 'a'), form)
    const other = [
      resolveRecommendationQuery(active('ADMIN', 'b'), form),
      resolveRecommendationQuery(active('WAREHOUSE', 'a'), form),
      resolveRecommendationQuery(active('ADMIN', 'a'), { ...form, destinationLocationId: SRC }),
      resolveRecommendationQuery(active('ADMIN', 'a'), { ...form, productId: DST }),
      resolveRecommendationQuery(active('ADMIN', 'a'), { ...form, quantityText: '31' }),
    ]
    for (const query of other) expect(query).not.toEqual(base)
  })
})
