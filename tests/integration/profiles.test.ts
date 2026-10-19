import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { TEST_PASSWORD, TEST_USERS, anonClient, serviceClient } from './helpers'

const createdUserIds: string[] = []
const SEEDED_NAMES = [
  'Admin Test',
  'Sale B2B Test',
  'Nhân viên cửa hàng Test',
  'Nhân viên franchise Test',
  'Kho Test',
  'Xưởng Test',
  'Nhân viên đã nghỉ Test',
]

async function createUser(appMeta: Record<string, unknown>, userMeta: Record<string, unknown>) {
  const { data, error } = await serviceClient().auth.admin.createUser({
    email: `tmp-${randomUUID()}@chb-test.local`,
    password: TEST_PASSWORD,
    email_confirm: true,
    app_metadata: appMeta,
    user_metadata: userMeta,
  })
  expect(error).toBeNull()
  const id = data.user?.id as string
  createdUserIds.push(id)
  return id
}

async function profileOf(id: string) {
  const { data } = await serviceClient()
    .from('profiles')
    .select('full_name, is_active, roles(code)')
    .eq('id', id)
    .maybeSingle()
  return data
}

describe('profiles (AUTH-002)', () => {
  afterAll(async () => {
    const svc = serviceClient()
    for (const id of createdUserIds) {
      await svc.from('profiles').update({ is_active: false }).eq('id', id)
    }
  })

  it('seeds one profile per test account with role and defaults', async () => {
    const { data, error } = await serviceClient()
      .from('profiles')
      .select(
        'full_name, is_active, roles(code), locations:default_location_id(code), sales_channels:default_sales_channel_id(code), lead_sources:default_lead_source_id(code)',
      )
      .in('full_name', ['Admin Test', 'Nhân viên cửa hàng Test', 'Nhân viên đã nghỉ Test'])
    expect(error).toBeNull()
    const byName = Object.fromEntries((data ?? []).map((p) => [p.full_name, p]))
    expect(byName['Admin Test']).toMatchObject({
      is_active: true,
      roles: { code: 'ADMIN' },
      locations: { code: 'HN-VP' },
      sales_channels: { code: 'B2B' },
    })
    expect(byName['Nhân viên cửa hàng Test']).toMatchObject({
      roles: { code: 'STORE_STAFF' },
      locations: { code: 'HN-CH1' },
      sales_channels: { code: 'STORE' },
      lead_sources: { code: 'WALK_IN' },
    })
    expect(byName['Nhân viên đã nghỉ Test']).toMatchObject({ is_active: false })
    const { count } = await serviceClient()
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .in('full_name', SEEDED_NAMES)
    expect(count).toBe(Object.keys(TEST_USERS).length)
  })

  it('creates a profile when an admin sets role_code in app_metadata', async () => {
    const id = await createUser({ role_code: 'WAREHOUSE' }, { full_name: 'Người mới' })
    expect(await profileOf(id)).toMatchObject({
      full_name: 'Người mới',
      roles: { code: 'WAREHOUSE' },
    })
  })

  it('does not let user_metadata decide the role (fail closed: no profile)', async () => {
    const id = await createUser({}, { full_name: 'Giả mạo', role_code: 'ADMIN' })
    expect(await profileOf(id)).toBeNull()
  })

  it('creates no profile for unknown role codes or blank names', async () => {
    expect(
      await profileOf(await createUser({ role_code: 'HACKER' }, { full_name: 'X' })),
    ).toBeNull()
    expect(
      await profileOf(await createUser({ role_code: 'ADMIN' }, { full_name: '  ' })),
    ).toBeNull()
  })

  it('disables self sign-up', async () => {
    const { error } = await anonClient().auth.signUp({
      email: `signup-${randomUUID()}@chb-test.local`,
      password: TEST_PASSWORD,
    })
    expect(error).not.toBeNull()
  })

  it('refuses to hard-delete a user that has a profile', async () => {
    const id = await createUser({ role_code: 'STORE_STAFF' }, { full_name: 'Không xóa được' })
    const { error } = await serviceClient().auth.admin.deleteUser(id)
    expect(error).not.toBeNull()
    expect(await profileOf(id)).not.toBeNull()
  })
})
