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

async function settingId(key: string) {
  const { data } = await serviceClient().from('app_settings').select('id').eq('key', key).single()
  return data?.id as string
}

describe('app_settings (MD-007)', () => {
  it('lets Admin read and change a setting, stamping updated_by and auditing', async () => {
    const admin = await clientFor(TEST_USERS.admin)
    const crud = createCrudService(admin, 'app_settings', 'key')
    expect((await crud.list()).length).toBeGreaterThanOrEqual(7)

    const id = await settingId('reservation_ttl_hours')
    const updated = await crud.update(id, { value: 48 })
    expect(updated.value).toBe(48)
    const { data: me } = await admin
      .from('profiles')
      .select('id')
      .eq('full_name', 'Admin Test')
      .single()
    expect(updated.updated_by).toBe(me?.id)

    await crud.update(id, { value: 24 }) // restore the seeded value

    const { data: audit } = await serviceClient()
      .from('audit_logs')
      .select('before_data, after_data')
      .eq('entity_type', 'app_settings')
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .limit(2)
    expect(audit?.[1]?.after_data).toMatchObject({ value: 48 })
    expect(audit?.[1]?.before_data).toMatchObject({ value: 24 })
  })

  it('rejects invalid values for known keys', async () => {
    const crud = createCrudService(await clientFor(TEST_USERS.admin), 'app_settings', 'key')
    const bad = async (key: string, value: unknown) => {
      const error = (await crud
        .update(await settingId(key), { value } as never)
        .catch((e: unknown) => e)) as DbError
      return error.code
    }
    expect(await bad('reservation_ttl_hours', 0)).toBe('23514')
    expect(await bad('reservation_ttl_hours', 1.5)).toBe('23514')
    expect(await bad('reservation_ttl_hours', '24')).toBe('23514')
    expect(await bad('allocation_lead_days', -1)).toBe('23514')
    expect(await bad('default_deposit_type', 'HALF')).toBe('23514')
    expect(await bad('order_prefix', 'tet')).toBe('23514')
    expect(await bad('order_prefix', 'TET1')).toBe('23514')
    expect(await bad('forecast_window_days', 0)).toBe('23514')
  })

  it('rejects unknown keys', async () => {
    const crud = createCrudService(await clientFor(TEST_USERS.admin), 'app_settings', 'key')
    const error = (await crud
      .create({ key: 'made_up_key', value: 1 })
      .catch((e: unknown) => e)) as DbError
    expect(error.code).toBe('23514')
    expect(describeDbError(error)).toMatch(/không hợp lệ/)
  })

  it('refuses secrets inside sepay_config but accepts public QR info', async () => {
    const crud = createCrudService(await clientFor(TEST_USERS.admin), 'app_settings', 'key')
    const existing = await serviceClient()
      .from('app_settings')
      .select('id')
      .eq('key', 'sepay_config')
      .maybeSingle()
    const save = (value: unknown) =>
      existing.data
        ? crud.update(existing.data.id, { value } as never)
        : crud.create({ key: 'sepay_config', value } as never)

    const secrets = [
      { hmac_secret: 'x' },
      { nested: { apiKey: 'x' } },
      { Webhook_Token: 'x' },
      { password: 'x' },
    ]
    for (const secret of secrets) {
      const error = (await save(secret).catch((e: unknown) => e)) as DbError
      expect(error.code).toBe('23514')
    }
    const ok = await save({ bank: 'MB', account_no: '0123456789', account_name: 'CONG TY TEST' })
    expect(ok.value).toMatchObject({ bank: 'MB' })
    expect(((await save('not-an-object').catch((e: unknown) => e)) as DbError).code).toBe('23514')
  })

  it('is invisible and read-only for every non-admin role', async () => {
    const id = await settingId('reservation_ttl_hours')
    const others = [
      TEST_USERS.sale,
      TEST_USERS.store,
      TEST_USERS.franchise,
      TEST_USERS.warehouse,
      TEST_USERS.production,
      TEST_USERS.inactive,
    ]
    for (const email of others) {
      const crud = createCrudService(await clientFor(email), 'app_settings', 'key')
      expect(await crud.list()).toHaveLength(0)
      const error = (await crud.update(id, { value: 1 }).catch((e: unknown) => e)) as DbError
      expect(error.code).toBe('PGRST116')
    }
    const { data } = await serviceClient()
      .from('app_settings')
      .select('value')
      .eq('id', id)
      .single()
    expect(data?.value).toBe(24)
  })

  it('cannot be deleted through the API', async () => {
    const admin = await clientFor(TEST_USERS.admin)
    const id = await settingId('order_prefix')
    const del = await admin.from('app_settings').delete().eq('id', id).select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
  })
})
