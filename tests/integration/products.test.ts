import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { describeDbError } from '@/lib/db-errors'
import type { AppSupabaseClient } from '@/lib/supabase'
import { createCrudService, type DbError } from '@/services/crud.service'
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

const sku = () => `P-${randomUUID().slice(0, 8).toUpperCase()}`
const base = { name: 'Sản phẩm test', list_price: 100000 }

describe('products (MD-004)', () => {
  it('seeds 11 demo SKUs, 10 active, with integer VND prices', async () => {
    const { data } = await serviceClient()
      .from('products')
      .select('sku, list_price, is_active')
      .not('sku', 'like', 'P-%') // rows created by other tests
    expect(data).toHaveLength(11)
    expect(data?.filter((p) => p.is_active)).toHaveLength(10)
    expect(data?.every((p) => Number.isInteger(p.list_price))).toBe(true)
  })

  it('lets Admin create, edit price/commission and deactivate, with audit', async () => {
    const crud = createCrudService(await clientFor(TEST_USERS.admin), 'products', 'sku')
    const created = await crud.create({ ...base, sku: sku(), default_commission_rate: 7.5 })
    expect(created).toMatchObject({
      list_price: 100000,
      default_commission_rate: 7.5,
      is_active: true,
    })

    const updated = await crud.update(created.id, {
      list_price: 120000,
      default_commission_rate: 8,
    })
    expect(updated).toMatchObject({ list_price: 120000, default_commission_rate: 8 })
    expect((await crud.update(created.id, { is_active: false })).is_active).toBe(false)

    const { data: audit } = await serviceClient()
      .from('audit_logs')
      .select('action, before_data, after_data')
      .eq('entity_type', 'products')
      .eq('entity_id', created.id)
      .order('created_at')
    expect(audit?.map((a) => a.action)).toEqual(['insert', 'update', 'update'])
    expect(audit?.[1]?.before_data).toMatchObject({ list_price: 100000 })
    expect(audit?.[1]?.after_data).toMatchObject({ list_price: 120000 })
  })

  it('enforces database constraints (price, commission, weight, name, unique SKU)', async () => {
    const crud = createCrudService(await clientFor(TEST_USERS.admin), 'products', 'sku')
    const fail = (input: Parameters<typeof crud.create>[0]) =>
      crud.create(input).catch((e: unknown) => e as DbError)

    expect(((await fail({ ...base, sku: sku(), list_price: -1 })) as DbError).code).toBe('23514')
    expect(
      ((await fail({ ...base, sku: sku(), default_commission_rate: 100.01 })) as DbError).code,
    ).toBe('23514')
    expect(
      ((await fail({ ...base, sku: sku(), default_commission_rate: -1 })) as DbError).code,
    ).toBe('23514')
    expect(((await fail({ ...base, sku: sku(), weight_gram: 0 })) as DbError).code).toBe('23514')
    expect(((await fail({ ...base, sku: sku(), name: '  ' })) as DbError).code).toBe('23514')

    const code = sku()
    await crud.create({ ...base, sku: code })
    const dup = (await fail({ ...base, sku: code })) as DbError
    expect(describeDbError(dup)).toMatch(/đã tồn tại/)
  })

  it('lets every active role read products but only Admin write', async () => {
    for (const email of [TEST_USERS.sale, TEST_USERS.warehouse, TEST_USERS.production]) {
      const crud = createCrudService(await clientFor(email), 'products', 'sku')
      expect((await crud.list()).length).toBeGreaterThanOrEqual(11)
      const error = await crud.create({ ...base, sku: sku() }).catch((e: unknown) => e)
      expect(describeDbError(error as DbError)).toMatch(/không có quyền/)
    }
    const inactive = createCrudService(await clientFor(TEST_USERS.inactive), 'products', 'sku')
    expect(await inactive.list()).toHaveLength(0)
  })

  it('does not allow a non-admin to change a price', async () => {
    const crud = createCrudService(await clientFor(TEST_USERS.store), 'products', 'sku')
    const [first] = await crud.list()
    const error = await crud.update(first?.id as string, { list_price: 1 }).catch((e: unknown) => e)
    expect((error as DbError).code).toBe('PGRST116')
    const { data } = await serviceClient()
      .from('products')
      .select('list_price')
      .eq('id', first?.id as string)
      .single()
    expect(data?.list_price).not.toBe(1)
  })

  it('has no delete path for anyone', async () => {
    const admin = await clientFor(TEST_USERS.admin)
    const { data } = await serviceClient().from('products').select('id').limit(1).single()
    const del = await admin
      .from('products')
      .delete()
      .eq('id', data?.id as string)
      .select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
  })
})
