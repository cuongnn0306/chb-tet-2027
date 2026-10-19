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

async function ids() {
  const svc = serviceClient()
  const role = await svc.from('roles').select('id').eq('code', 'STORE_STAFF').single()
  const user = await svc.from('profiles').select('id').eq('full_name', 'Sale B2B Test').single()
  const product = await svc.from('products').select('id').eq('sku', 'TT-800').single()
  return {
    roleId: role.data?.id as string,
    userId: user.data?.id as string,
    productId: product.data?.id as string,
  }
}

describe('commission_rules (MD-005)', () => {
  it('lets Admin create role and user rules, edit and deactivate, with audit', async () => {
    const { roleId, userId, productId } = await ids()
    const crud = createCrudService(
      await clientFor(TEST_USERS.admin),
      'commission_rules',
      'effective_from',
    )

    const roleRule = await crud.create({
      role_id: roleId,
      rate_percent: 6.5,
      effective_from: '2026-11-01',
    })
    expect(roleRule).toMatchObject({
      role_id: roleId,
      user_id: null,
      product_id: null,
      rate_percent: 6.5,
    })

    const userRule = await crud.create({
      user_id: userId,
      product_id: productId,
      rate_percent: 9,
      effective_from: '2026-11-01',
      effective_to: '2027-02-28',
    })
    expect(userRule.product_id).toBe(productId)

    await crud.update(roleRule.id, { rate_percent: 7 })
    expect((await crud.update(roleRule.id, { is_active: false })).is_active).toBe(false)

    const { data: audit } = await serviceClient()
      .from('audit_logs')
      .select('action')
      .eq('entity_type', 'commission_rules')
      .eq('entity_id', roleRule.id)
      .order('created_at')
    expect(audit?.map((a) => a.action)).toEqual(['insert', 'update', 'update'])
  })

  it('enforces database constraints', async () => {
    const { roleId, userId } = await ids()
    const crud = createCrudService(
      await clientFor(TEST_USERS.admin),
      'commission_rules',
      'effective_from',
    )
    const code = async (input: Parameters<typeof crud.create>[0]) =>
      ((await crud.create(input).catch((e: unknown) => e)) as DbError).code

    // both user and role, or neither
    expect(
      await code({
        user_id: userId,
        role_id: roleId,
        rate_percent: 5,
        effective_from: '2026-11-01',
      }),
    ).toBe('23514')
    expect(await code({ rate_percent: 5, effective_from: '2026-11-01' })).toBe('23514')
    // rate range, period order
    expect(await code({ role_id: roleId, rate_percent: 101, effective_from: '2026-11-01' })).toBe(
      '23514',
    )
    expect(await code({ role_id: roleId, rate_percent: -1, effective_from: '2026-11-01' })).toBe(
      '23514',
    )
    expect(
      await code({
        role_id: roleId,
        rate_percent: 5,
        effective_from: '2026-11-01',
        effective_to: '2026-10-01',
      }),
    ).toBe('23514')
  })

  it('is hidden from every non-admin role (commission is Admin-only data)', async () => {
    const { roleId } = await ids()
    for (const email of [
      TEST_USERS.sale,
      TEST_USERS.store,
      TEST_USERS.franchise,
      TEST_USERS.warehouse,
      TEST_USERS.production,
      TEST_USERS.inactive,
    ]) {
      const crud = createCrudService(await clientFor(email), 'commission_rules', 'effective_from')
      expect(await crud.list()).toHaveLength(0)
      const error = await crud
        .create({ role_id: roleId, rate_percent: 50, effective_from: '2026-11-01' })
        .catch((e: unknown) => e)
      expect(describeDbError(error as DbError)).toMatch(/không có quyền/)
    }
  })

  it('has seeded example rules visible to Admin', async () => {
    const crud = createCrudService(
      await clientFor(TEST_USERS.admin),
      'commission_rules',
      'effective_from',
    )
    expect((await crud.list()).length).toBeGreaterThanOrEqual(3)
  })

  it('cannot be deleted by anyone through the API', async () => {
    const admin = await clientFor(TEST_USERS.admin)
    const { data } = await serviceClient().from('commission_rules').select('id').limit(1).single()
    const del = await admin
      .from('commission_rules')
      .delete()
      .eq('id', data?.id as string)
      .select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
  })
})
