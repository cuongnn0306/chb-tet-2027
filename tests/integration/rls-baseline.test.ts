import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { ROLE_CODES } from '@/domain/auth/roles'
import { TEST_USERS, anonClient, serviceClient, signedInClient } from './helpers'

const MASTER_TABLES = ['locations', 'sales_channels', 'lead_sources'] as const

let admin: SupabaseClient
let sale: SupabaseClient
let store: SupabaseClient
let warehouse: SupabaseClient
let production: SupabaseClient
let franchise: SupabaseClient
let inactive: SupabaseClient

beforeAll(async () => {
  ;[admin, sale, store, warehouse, production, franchise, inactive] = await Promise.all([
    signedInClient(TEST_USERS.admin),
    signedInClient(TEST_USERS.sale),
    signedInClient(TEST_USERS.store),
    signedInClient(TEST_USERS.warehouse),
    signedInClient(TEST_USERS.production),
    signedInClient(TEST_USERS.franchise),
    signedInClient(TEST_USERS.inactive),
  ])
})

describe('anonymous access', () => {
  it.each(['roles', 'profiles', 'audit_logs', ...MASTER_TABLES])(
    'cannot read %s',
    async (table) => {
      const { data, error } = await anonClient().from(table).select('*')
      expect(error !== null || (data ?? []).length === 0).toBe(true)
    },
  )

  it('cannot write master data', async () => {
    const { error } = await anonClient()
      .from('locations')
      .insert({ code: `ANON-${randomUUID()}`, name: 'x', location_type: 'STORE' })
    expect(error).not.toBeNull()
  })
})

describe('inactive user (fail closed)', () => {
  it.each(['roles', ...MASTER_TABLES])('sees no rows in %s', async (table) => {
    const { data } = await inactive.from(table).select('*')
    expect(data ?? []).toHaveLength(0)
  })

  it('can read only their own profile, which shows the inactive status', async () => {
    const { data } = await inactive.from('profiles').select('full_name, is_active')
    expect(data).toEqual([{ full_name: 'Nhân viên đã nghỉ Test', is_active: false }])
  })
})

describe.each([
  ['sale', () => sale],
  ['store', () => store],
  ['franchise', () => franchise],
  ['warehouse', () => warehouse],
  ['production', () => production],
  ['admin', () => admin],
])('active %s user reads', (_name, client) => {
  it('roles and master data', async () => {
    const roles = await client().from('roles').select('code')
    expect(roles.data?.map((r) => r.code).sort()).toEqual([...ROLE_CODES].sort())
    for (const table of MASTER_TABLES) {
      const { data, error } = await client().from(table).select('id')
      expect(error).toBeNull()
      expect((data ?? []).length).toBeGreaterThan(0)
    }
  })
})

describe('master data writes are Admin-only', () => {
  it.each([
    ['sale', () => sale],
    ['store', () => store],
    ['warehouse', () => warehouse],
    ['production', () => production],
  ])('%s cannot insert or update locations', async (_n, client) => {
    const insert = await client()
      .from('locations')
      .insert({ code: `NOPE-${randomUUID()}`, name: 'x', location_type: 'STORE' })
    expect(insert.error).not.toBeNull()

    const update = await client()
      .from('locations')
      .update({ name: 'hacked' })
      .eq('code', 'HN-CH1')
      .select()
    expect(update.data ?? []).toHaveLength(0)
    const { data } = await serviceClient().from('locations').select('name').eq('code', 'HN-CH1')
    expect(data?.[0]?.name).toBe('[Test] Cửa hàng CHB 1')
  })

  it.each([
    ['sales_channels', { code: 'X', name: 'x' }],
    ['lead_sources', { code: 'X', name: 'x' }],
  ] as const)('non-admin cannot insert into %s', async (table, row) => {
    const { error } = await store.from(table).insert({ ...row, code: `T-${randomUUID()}` })
    expect(error).not.toBeNull()
  })

  it('Admin can insert and deactivate, but never delete', async () => {
    const code = `RLS-${randomUUID()}`
    const insert = await admin
      .from('locations')
      .insert({ code, name: 'Admin tạo', location_type: 'STORE' })
      .select('id')
      .single()
    expect(insert.error).toBeNull()
    const id = insert.data?.id as string

    const update = await admin
      .from('locations')
      .update({ is_active: false })
      .eq('id', id)
      .select('is_active')
    expect(update.data).toEqual([{ is_active: false }])

    const del = await admin.from('locations').delete().eq('id', id).select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    const { data } = await serviceClient().from('locations').select('id').eq('id', id)
    expect(data).toHaveLength(1)
  })

  it('rejects an invalid location type', async () => {
    const { error } = await admin
      .from('locations')
      .insert({ code: `BAD-${randomUUID()}`, name: 'x', location_type: 'WAREHOUSE' })
    expect(error).not.toBeNull()
  })
})

describe('profiles', () => {
  it('lets a non-admin read only their own profile', async () => {
    const { data } = await store.from('profiles').select('full_name')
    expect(data).toEqual([{ full_name: 'Nhân viên cửa hàng Test' }])
  })

  it('lets Admin read every profile', async () => {
    const { data } = await admin.from('profiles').select('id')
    expect((data ?? []).length).toBeGreaterThanOrEqual(7)
  })

  it('blocks role escalation by a non-admin on their own profile', async () => {
    const { data: adminRole } = await serviceClient()
      .from('roles')
      .select('id')
      .eq('code', 'ADMIN')
      .single()
    const { data: me } = await store.from('profiles').select('id').single()
    const update = await store
      .from('profiles')
      .update({ role_id: adminRole?.id })
      .eq('id', me?.id)
      .select()
    expect(update.data ?? []).toHaveLength(0)
    const { data } = await serviceClient()
      .from('profiles')
      .select('roles(code)')
      .eq('id', me?.id)
      .single()
    expect(data).toMatchObject({ roles: { code: 'STORE_STAFF' } })
  })

  it('blocks a non-admin from deactivating or editing another profile', async () => {
    const update = await sale
      .from('profiles')
      .update({ is_active: false })
      .eq('full_name', 'Admin Test')
      .select()
    expect(update.data ?? []).toHaveLength(0)
  })

  it('never allows deleting a profile', async () => {
    const del = await admin.from('profiles').delete().eq('full_name', 'Kho Test').select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    const { count } = await serviceClient()
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('full_name', 'Kho Test')
    expect(count).toBe(1)
  })
})

describe('audit_logs', () => {
  it('is readable only by Admin', async () => {
    const asAdmin = await admin.from('audit_logs').select('id').limit(1)
    expect(asAdmin.error).toBeNull()
    expect((asAdmin.data ?? []).length).toBe(1)
    for (const client of [sale, store, warehouse, production, franchise, inactive]) {
      const { data } = await client.from('audit_logs').select('id').limit(1)
      expect(data ?? []).toHaveLength(0)
    }
  })

  it('records who changed master data, with before/after', async () => {
    const code = `AUD-${randomUUID()}`
    const { data: created } = await admin
      .from('locations')
      .insert({ code, name: 'Trước', location_type: 'STORE' })
      .select('id')
      .single()
    await admin.from('locations').update({ name: 'Sau' }).eq('id', created?.id)

    const { data: adminProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('full_name', 'Admin Test')
      .single()
    const { data: logs } = await admin
      .from('audit_logs')
      .select('action, actor_user_id, before_data, after_data')
      .eq('entity_type', 'locations')
      .eq('entity_id', created?.id)
      .order('created_at')
    expect(logs?.map((l) => l.action)).toEqual(['insert', 'update'])
    expect(logs?.every((l) => l.actor_user_id === adminProfile?.id)).toBe(true)
    expect(logs?.[1]?.before_data).toMatchObject({ name: 'Trước' })
    expect(logs?.[1]?.after_data).toMatchObject({ name: 'Sau' })
  })

  it('cannot be written, edited or deleted by any client', async () => {
    const row = {
      entity_type: 'locations',
      action: 'insert',
    }
    const insert = await admin.from('audit_logs').insert(row)
    expect(insert.error).not.toBeNull()
    const update = await admin
      .from('audit_logs')
      .update({ action: 'x' })
      .neq('id', randomUUID())
      .select()
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true)
    const del = await admin.from('audit_logs').delete().neq('id', randomUUID()).select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
  })

  it('is immutable even for the service role', async () => {
    const svc = serviceClient()
    const { data } = await svc.from('audit_logs').select('id').limit(1).single()
    const update = await svc.from('audit_logs').update({ action: 'tampered' }).eq('id', data?.id)
    expect(update.error?.message).toMatch(/bất biến/)
    const del = await svc.from('audit_logs').delete().eq('id', data?.id)
    expect(del.error?.message).toMatch(/bất biến/)
  })
})

describe('permission helpers', () => {
  it('are not callable through the Data API schema', async () => {
    const { error } = await admin.rpc('is_admin')
    expect(error).not.toBeNull()
  })
})
