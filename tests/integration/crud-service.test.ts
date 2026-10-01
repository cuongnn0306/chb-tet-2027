import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { describeDbError } from '@/lib/db-errors'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError, createCrudService } from '@/services/crud.service'
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

const code = () => `CRUD-${randomUUID().slice(0, 8).toUpperCase()}`

describe.each([
  ['locations', 'code'],
  ['sales_channels', 'sort_order'],
  ['lead_sources', 'sort_order'],
] as const)('crud service on %s (MD-001..003)', (table, orderBy) => {
  it('lets Admin create, list, edit and deactivate (never delete)', async () => {
    const admin = await clientFor(TEST_USERS.admin)
    const crud = createCrudService(admin, table, orderBy)
    const c = code()
    const input =
      table === 'locations'
        ? { code: c, name: 'Tạo bởi test', location_type: 'STORE' }
        : { code: c, name: 'Tạo bởi test', sort_order: 99 }

    const created = await crud.create(input as never)
    expect(created).toMatchObject({ code: c, is_active: true })

    expect((await crud.list()).some((row) => row.id === created.id)).toBe(true)

    const renamed = await crud.update(created.id, { name: 'Đã đổi tên' } as never)
    expect(renamed.name).toBe('Đã đổi tên')

    const deactivated = await crud.update(created.id, { is_active: false } as never)
    expect(deactivated.is_active).toBe(false)

    // The row is still there (history stays traceable) and the changes were audited.
    const { data: audit } = await serviceClient()
      .from('audit_logs')
      .select('action')
      .eq('entity_type', table)
      .eq('entity_id', created.id)
      .order('created_at')
    expect(audit?.map((a) => a.action)).toEqual(['insert', 'update', 'update'])
  })

  it('reports a duplicate code with a friendly message', async () => {
    const admin = await clientFor(TEST_USERS.admin)
    const crud = createCrudService(admin, table, orderBy)
    const c = code()
    const input =
      table === 'locations'
        ? { code: c, name: 'A', location_type: 'OFFICE' }
        : { code: c, name: 'A', sort_order: 1 }
    await crud.create(input as never)
    const error = await crud.create(input as never).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DbError)
    expect(describeDbError(error as DbError)).toMatch(/đã tồn tại/)
  })

  it('denies writes to a non-admin with a permission message', async () => {
    const store = await clientFor(TEST_USERS.store)
    const crud = createCrudService(store, table, orderBy)
    const input =
      table === 'locations'
        ? { code: code(), name: 'X', location_type: 'STORE' }
        : { code: code(), name: 'X', sort_order: 1 }
    const error = await crud.create(input as never).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DbError)
    expect(describeDbError(error as DbError)).toMatch(/không có quyền/)
    // Reading is allowed for every active user.
    expect((await crud.list()).length).toBeGreaterThan(0)
  })

  it('does not update rows a non-admin cannot see as writable', async () => {
    const store = await clientFor(TEST_USERS.store)
    const crud = createCrudService(store, table, orderBy)
    const [first] = await crud.list()
    const error = await crud
      .update(first?.id as string, { name: 'hacked' } as never)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DbError)
    expect((error as DbError).code).toBe('PGRST116')
  })
})
