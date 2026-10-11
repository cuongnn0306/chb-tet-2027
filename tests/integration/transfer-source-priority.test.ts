import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { serviceClient, signedInClient, TEST_USERS } from './helpers'

interface Source {
  location_id: string
  sellable_qty: number
  same_region: boolean
  covers_all: boolean
  earliest_expiry: string
}

let admin: SupabaseClient
let sale: SupabaseClient
let production: SupabaseClient

beforeAll(async () => {
  ;[admin, sale, production] = await Promise.all([
    signedInClient(TEST_USERS.admin),
    signedInClient(TEST_USERS.sale),
    signedInClient(TEST_USERS.production),
  ])
})

async function location(region = 'HN', isActive = true) {
  const tag = randomUUID()
  const { data, error } = await serviceClient()
    .from('locations')
    .insert({
      code: `SRC-${tag}`,
      name: `Kho gợi ý ${tag}`,
      location_type: 'STORE',
      region,
      is_active: isActive,
    })
    .select('id')
    .single()
  expect(error).toBeNull()
  if (!data) throw new Error('Không tạo được kho test.')
  return data.id as string
}

async function fixture() {
  const tag = randomUUID()
  const { data, error } = await serviceClient()
    .from('products')
    .insert({
      sku: `P-SRC-${tag}`,
      name: `Sản phẩm gợi ý ${tag}`,
      list_price: 100000,
      default_commission_rate: 8,
    })
    .select('id')
    .single()
  expect(error).toBeNull()
  if (!data) throw new Error('Không tạo được sản phẩm test.')
  return { productId: data.id as string, destinationId: await location() }
}

async function stock(
  productId: string,
  locationId: string,
  quantity: number,
  expiry = '2099-06-01',
) {
  const { data, error } = await admin
    .from('product_batches')
    .insert({
      batch_code: `SRC-${randomUUID()}`,
      product_id: productId,
      manufactured_date: '2026-01-01',
      expiry_date: expiry,
    })
    .select('id')
    .single()
  expect(error).toBeNull()
  if (!data) throw new Error('Không tạo được lô test.')
  expect(
    (
      await admin.rpc('record_opening_stock', {
        p_location_id: locationId,
        p_product_id: productId,
        p_batch_id: data.id,
        p_quantity: quantity,
      })
    ).error,
  ).toBeNull()
}

async function suggestions(productId: string, destinationId: string, quantity: number) {
  const { data, error } = await sale.rpc('suggest_transfer_sources', {
    p_product_id: productId,
    p_destination_location_id: destinationId,
    p_quantity: quantity,
  })
  expect(error).toBeNull()
  return data as Source[]
}

describe('RES-010 source priority', () => {
  it('prefers earlier expiry among equally covering same-region warehouses even when it has more stock', async () => {
    const { productId, destinationId } = await fixture()
    const early = await location()
    const late = await location()
    await stock(productId, early, 100, '2099-01-01')
    await stock(productId, late, 20, '2099-06-01')
    const sources = await suggestions(productId, destinationId, 10)
    expect(sources.map((source) => source.location_id)).toEqual([early, late])
    expect(sources[0]).toMatchObject({
      earliest_expiry: '2099-01-01',
      sellable_qty: 100,
      covers_all: true,
    })
  })

  it('prefers more stock when region, coverage and expiry tie to reduce splitting', async () => {
    const { productId, destinationId } = await fixture()
    const small = await location()
    const large = await location()
    await stock(productId, small, 3)
    await stock(productId, large, 8)
    expect(
      (await suggestions(productId, destinationId, 10)).map((source) => source.location_id),
    ).toEqual([large, small])
  })

  it('ranks full coverage before expiry, within the same region', async () => {
    const { productId, destinationId } = await fixture()
    const partial = await location()
    const full = await location()
    await stock(productId, partial, 5, '2099-01-01')
    await stock(productId, full, 20, '2099-06-01')
    expect(
      (await suggestions(productId, destinationId, 10)).map((source) => source.location_id),
    ).toEqual([full, partial])
  })

  it('keeps same-region priority ahead of coverage and expiry', async () => {
    const { productId, destinationId } = await fixture()
    const near = await location()
    const far = await location('HCM')
    await stock(productId, near, 3, '2099-06-01')
    await stock(productId, far, 100, '2099-01-01')
    const sources = await suggestions(productId, destinationId, 10)
    expect(sources.map((source) => source.location_id)).toEqual([near, far])
    expect(sources[0]).toMatchObject({ same_region: true, covers_all: false })
  })

  it('excludes destination, inactive locations and safety-stock-only stock without posting movements', async () => {
    const { productId, destinationId } = await fixture()
    const safe = await location()
    const usable = await location()
    const inactive = await location()
    await stock(productId, destinationId, 50)
    await stock(productId, safe, 10)
    await stock(productId, usable, 20)
    await stock(productId, inactive, 30)
    expect(
      (await admin.from('locations').update({ is_active: false }).eq('id', inactive)).error,
    ).toBeNull()
    expect(
      (
        await admin
          .from('safety_stock_rules')
          .insert({ location_id: safe, product_id: productId, minimum_qty: 10 })
      ).error,
    ).toBeNull()
    const before = await serviceClient()
      .from('inventory_movements')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId)
    expect(before.error).toBeNull()
    expect(
      (await suggestions(productId, destinationId, 10)).map((source) => source.location_id),
    ).toEqual([usable])
    const after = await serviceClient()
      .from('inventory_movements')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', productId)
    expect(after.error).toBeNull()
    expect(after.count).toBe(before.count)
    expect(
      (
        await production.rpc('suggest_transfer_sources', {
          p_product_id: productId,
          p_destination_location_id: destinationId,
          p_quantity: 10,
        })
      ).error?.code,
    ).toBe('42501')
  })
})
