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

/** A location x product pair that has no seeded rule, so tests can create one. */
async function freePair() {
  const svc = serviceClient()
  const { data: loc } = await svc.from('locations').select('id').eq('code', 'HN-CH2').single()
  const { data: prods } = await svc
    .from('products')
    .select('id, sku')
    .in('sku', ['TT-500', 'COM-500'])
  return { locationId: loc?.id as string, productIds: (prods ?? []).map((p) => p.id) }
}

describe('safety_stock_rules (MD-006)', () => {
  it('has the seeded example rules', async () => {
    const { count } = await serviceClient()
      .from('safety_stock_rules')
      .select('*', { count: 'exact', head: true })
    expect(count).toBeGreaterThanOrEqual(5)
  })

  it('lets Admin set and change a rule, stamping updated_by and auditing', async () => {
    const admin = await clientFor(TEST_USERS.admin)
    const crud = createCrudService(admin, 'safety_stock_rules', 'updated_at')
    const { locationId, productIds } = await freePair()
    const productId = productIds[0] as string

    // idempotent across reruns: remove nothing (no delete), reuse the row if it already exists
    const existing = (await crud.list()).find(
      (r) => r.location_id === locationId && r.product_id === productId,
    )
    const rule =
      existing ??
      (await crud.create({ location_id: locationId, product_id: productId, minimum_qty: 12 }))

    const updated = await crud.update(rule.id, { minimum_qty: 30 })
    expect(updated.minimum_qty).toBe(30)

    const { data: adminProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('full_name', 'Admin Test')
      .single()
    expect(updated.updated_by).toBe(adminProfile?.id)

    const { data: audit } = await serviceClient()
      .from('audit_logs')
      .select('action, after_data')
      .eq('entity_type', 'safety_stock_rules')
      .eq('entity_id', rule.id)
      .order('created_at')
    expect(audit?.at(-1)?.action).toBe('update')
    expect(audit?.at(-1)?.after_data).toMatchObject({ minimum_qty: 30 })
  })

  it('allows one rule per location x product and rejects negatives', async () => {
    const crud = createCrudService(
      await clientFor(TEST_USERS.admin),
      'safety_stock_rules',
      'updated_at',
    )
    const { locationId, productIds } = await freePair()
    const productId = productIds[1] as string
    const existing = (await crud.list()).find(
      (r) => r.location_id === locationId && r.product_id === productId,
    )
    if (!existing)
      await crud.create({ location_id: locationId, product_id: productId, minimum_qty: 5 })

    const dup = (await crud
      .create({ location_id: locationId, product_id: productId, minimum_qty: 6 })
      .catch((e: unknown) => e)) as DbError
    expect(dup.code).toBe('23505')
    expect(describeDbError(dup)).toMatch(/đã tồn tại/)

    const negative = (await crud
      .create({ location_id: locationId, product_id: productIds[0] as string, minimum_qty: -1 })
      .catch((e: unknown) => e)) as DbError
    expect(['23514', '23505']).toContain(negative.code)
  })

  it('is readable by every active role but writable only by Admin', async () => {
    const { locationId, productIds } = await freePair()
    for (const email of [
      TEST_USERS.sale,
      TEST_USERS.store,
      TEST_USERS.franchise,
      TEST_USERS.warehouse,
      TEST_USERS.production,
    ]) {
      const crud = createCrudService(await clientFor(email), 'safety_stock_rules', 'updated_at')
      expect((await crud.list()).length).toBeGreaterThanOrEqual(5)
      const error = (await crud
        .create({ location_id: locationId, product_id: productIds[0] as string, minimum_qty: 1 })
        .catch((e: unknown) => e)) as DbError
      expect(describeDbError(error)).toMatch(/không có quyền/)
    }
    const inactive = createCrudService(
      await clientFor(TEST_USERS.inactive),
      'safety_stock_rules',
      'updated_at',
    )
    expect(await inactive.list()).toHaveLength(0)
  })

  it('cannot be deleted through the API', async () => {
    const admin = await clientFor(TEST_USERS.admin)
    const { data } = await serviceClient().from('safety_stock_rules').select('id').limit(1).single()
    const del = await admin
      .from('safety_stock_rules')
      .delete()
      .eq('id', data?.id as string)
      .select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
  })
})
