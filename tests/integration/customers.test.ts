import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { CustomerFields } from '@/domain/customers/validation'
import { normalizePhone } from '@/lib/phone'
import type { AppSupabaseClient } from '@/lib/supabase'
import type { DbError } from '@/services/crud.service'
import { createCustomerService } from '@/services/customers.service'
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

const individual = (over: Partial<CustomerFields> = {}): CustomerFields => ({
  customerType: 'INDIVIDUAL',
  name: `Khách test ${randomUUID().slice(0, 6)}`,
  phone: '',
  address: '',
  companyName: '',
  taxCode: '',
  contactName: '',
  contactTitle: '',
  email: '',
  companyAddress: '',
  ...over,
})

const company = (over: Partial<CustomerFields> = {}): CustomerFields =>
  individual({
    customerType: 'COMPANY',
    name: '',
    companyName: `Công ty test ${randomUUID().slice(0, 6)}`,
    ...over,
  })

/** A phone number unique to this run so searches only see this test's rows. */
const uniquePhone = () => `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`

describe('phone normalisation parity (CUS-003)', () => {
  it('SQL normalize_phone() and the TypeScript normalizePhone() agree', async () => {
    const samples = [
      '0901234567',
      '090 123 4567',
      '090.123.4567',
      '+84 90 123 4567',
      '84901234567',
      '0084901234567',
      '(090) 123-4567',
      '024 3825 1234',
      '0841234567',
      '12345',
      'abc',
      '',
    ]
    const svc = serviceClient()
    for (const sample of samples) {
      const { data, error } = await svc.rpc('normalize_phone', { p_phone: sample })
      expect(error).toBeNull()
      expect(data, `phone "${sample}"`).toBe(normalizePhone(sample))
    }
  })
})

describe('customers table (CUS-001)', () => {
  it('has seeded customers including a duplicate-phone pair and an archived one', async () => {
    const { data } = await serviceClient()
      .from('customers')
      .select('name, phone_normalized, is_archived')
      .in('phone_normalized', ['0900000001', '0900000006'])
    expect(data).toHaveLength(3)
    expect(data?.filter((c) => c.phone_normalized === '0900000001')).toHaveLength(2)
    expect(data?.filter((c) => c.is_archived)).toHaveLength(1)
  })

  it('allows duplicate phones and tax codes (no unique constraint)', async () => {
    const sale = createCustomerService(await clientFor(TEST_USERS.sale))
    const phone = uniquePhone()
    await sale.create(individual({ phone }))
    await sale.create(individual({ phone: `+84 ${phone.slice(1)}` }))
    const tax = `01${Math.floor(10_000_000 + Math.random() * 89_999_999)}`
    await sale.create(company({ taxCode: tax }))
    await sale.create(company({ taxCode: tax }))
    expect((await sale.findSimilar({ phone })).length).toBe(2)
  })

  it('enforces a name by type at the database level', async () => {
    const sale = await clientFor(TEST_USERS.sale)
    const { data: me } = await sale.from('profiles').select('id').single()
    const noName = await sale
      .from('customers')
      .insert({ customer_type: 'INDIVIDUAL', name: '  ', created_by: me?.id as string })
    expect(noName.error?.code).toBe('23514')
    const noCompany = await sale
      .from('customers')
      .insert({ customer_type: 'COMPANY', name: 'Có tên người', created_by: me?.id as string })
    expect(noCompany.error?.code).toBe('23514')
    const badType = await sale
      .from('customers')
      .insert({ customer_type: 'VIP', name: 'x', created_by: me?.id as string })
    expect(badType.error?.code).toBe('23514')
  })

  it('stamps created_by with the signed-in user, neutralising a spoofed value', async () => {
    const sale = await clientFor(TEST_USERS.sale)
    const store = await clientFor(TEST_USERS.store)
    const { data: storeProfile } = await store.from('profiles').select('id').single()
    const { data: saleProfile } = await sale.from('profiles').select('id').single()

    // The caller names someone else as creator: the database overwrites it with the caller.
    const spoofed = await sale
      .from('customers')
      .insert({
        customer_type: 'INDIVIDUAL',
        name: 'Giả mạo',
        created_by: storeProfile?.id as string,
      })
      .select('created_by')
      .single()
    expect(spoofed.data?.created_by).toBe(saleProfile?.id)

    const created = await createCustomerService(sale).create(individual())
    expect(created.created_by).toBe(saleProfile?.id)
  })

  it('never reassigns created_by on update', async () => {
    const admin = await clientFor(TEST_USERS.admin)
    const sale = await clientFor(TEST_USERS.sale)
    const created = await createCustomerService(sale).create(individual())
    const { data: adminProfile } = await admin.from('profiles').select('id').single()
    const { data } = await admin
      .from('customers')
      .update({ created_by: adminProfile?.id as string, address: 'Admin sửa' })
      .eq('id', created.id)
      .select('created_by, address')
      .single()
    expect(data?.address).toBe('Admin sửa')
    expect(data?.created_by).toBe(created.created_by)
  })
})

describe('customers access control (RLS)', () => {
  it('lets order-creating roles read every customer, and others nothing', async () => {
    for (const email of [
      TEST_USERS.admin,
      TEST_USERS.sale,
      TEST_USERS.store,
      TEST_USERS.franchise,
    ]) {
      const { data } = await (await clientFor(email)).from('customers').select('id')
      expect((data ?? []).length).toBeGreaterThanOrEqual(7)
    }
    for (const email of [TEST_USERS.warehouse, TEST_USERS.production, TEST_USERS.inactive]) {
      const client = await clientFor(email)
      const { data } = await client.from('customers').select('id')
      expect(data ?? []).toHaveLength(0)
      const search = createCustomerService(client)
      expect(await search.search({ query: 'test' })).toHaveLength(0)
      expect(await search.findSimilar({ phone: '0900000001' })).toHaveLength(0)
    }
  })

  it('blocks warehouse/production from creating customers', async () => {
    for (const email of [TEST_USERS.warehouse, TEST_USERS.production]) {
      const client = await clientFor(email)
      const { data: me } = await client.from('profiles').select('id').single()
      const { error } = await client
        .from('customers')
        .insert({ customer_type: 'INDIVIDUAL', name: 'Không được', created_by: me?.id as string })
      expect(error).not.toBeNull()
    }
  })

  it('lets the creator and Admin edit, but not another sales user', async () => {
    const sale = createCustomerService(await clientFor(TEST_USERS.sale))
    const created = await sale.create(individual())
    const fields = individual({ name: created.name ?? 'x', address: 'Đã sửa' })

    expect((await sale.update(created.id, fields)).address).toBe('Đã sửa')

    const admin = createCustomerService(await clientFor(TEST_USERS.admin))
    expect((await admin.update(created.id, { ...fields, address: 'Admin sửa' })).address).toBe(
      'Admin sửa',
    )

    const store = createCustomerService(await clientFor(TEST_USERS.store))
    const error = (await store
      .update(created.id, { ...fields, address: 'Hack' })
      .catch((e: unknown) => e)) as DbError
    expect(error.code).toBe('PGRST116')
    expect((await admin.get(created.id))?.address).toBe('Admin sửa')
  })

  it('archives instead of deleting, and nobody can delete', async () => {
    const sale = createCustomerService(await clientFor(TEST_USERS.sale))
    const created = await sale.create(individual())
    expect((await sale.setArchived(created.id, true)).is_archived).toBe(true)
    expect((await sale.setArchived(created.id, false)).is_archived).toBe(false)

    const client = await clientFor(TEST_USERS.admin)
    const del = await client.from('customers').delete().eq('id', created.id).select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)
    expect(await sale.get(created.id)).not.toBeNull()
  })

  it('audits customer changes', async () => {
    const sale = createCustomerService(await clientFor(TEST_USERS.sale))
    const created = await sale.create(individual())
    await sale.setArchived(created.id, true)
    const { data } = await serviceClient()
      .from('audit_logs')
      .select('action')
      .eq('entity_type', 'customers')
      .eq('entity_id', created.id)
      .order('created_at')
    expect(data?.map((a) => a.action)).toEqual(['insert', 'update'])
  })
})

describe('customer search (CUS-006)', () => {
  it('finds accent-insensitively by name, company, contact, tax code, email and phone', async () => {
    const sale = createCustomerService(await clientFor(TEST_USERS.sale))
    const byName = await sale.search({ query: 'nguyen van test' })
    expect(byName.some((c) => c.name === 'Nguyễn Văn Test')).toBe(true)
    expect(
      (await sale.search({ query: 'NGUYỄN VĂN TEST' })).some((c) => c.name === 'Nguyễn Văn Test'),
    ).toBe(true)
    expect(
      (await sale.search({ query: 'cong ty tnhh test' })).some(
        (c) => c.company_name === 'Công ty TNHH Test ABC',
      ),
    ).toBe(true)
    expect((await sale.search({ query: 'le van lien' })).length).toBeGreaterThan(0)
    expect(
      (await sale.search({ query: '0100000002' })).some(
        (c) => c.company_name === 'Công ty CP Mẫu XYZ',
      ),
    ).toBe(true)
    expect((await sale.search({ query: 'hoa@xyz' })).length).toBe(1)
  })

  it('matches a phone typed in any format, including partial digits', async () => {
    const sale = createCustomerService(await clientFor(TEST_USERS.sale))
    const full = await sale.search({ query: '+84 90 000 0002' })
    expect(full.map((c) => c.name)).toContain('Trần Thị Mẫu')
    const partial = await sale.search({ query: '0900000' })
    expect(partial.length).toBeGreaterThanOrEqual(5)
    expect((await sale.search({ query: '09' })).length).toBe(
      (await sale.search({ query: '09' })).length,
    )
  })

  it('does not treat % or _ as wildcards and never errors on odd input', async () => {
    const sale = createCustomerService(await clientFor(TEST_USERS.sale))
    expect(await sale.search({ query: '%' })).toHaveLength(0)
    expect(await sale.search({ query: '_' })).toHaveLength(0)
    expect(await sale.search({ query: "'; drop table customers; --" })).toHaveLength(0)
    expect(await sale.search({ query: ',()*' })).toHaveLength(0)
  })

  it('filters by type and archived state, and pages results', async () => {
    const sale = createCustomerService(await clientFor(TEST_USERS.sale))
    const companies = await sale.search({ customerType: 'COMPANY' })
    expect(companies.every((c) => c.customer_type === 'COMPANY')).toBe(true)
    expect(companies.length).toBeGreaterThanOrEqual(2)

    const active = await sale.search({ query: 'lưu trữ' })
    expect(active).toHaveLength(0)
    const withArchived = await sale.search({ query: 'lưu trữ', includeArchived: true })
    expect(withArchived).toHaveLength(1)

    const page1 = await sale.search({ limit: 3, offset: 0 })
    const page2 = await sale.search({ limit: 3, offset: 3 })
    expect(page1).toHaveLength(3)
    expect(page2.every((c) => !page1.some((p) => p.id === c.id))).toBe(true)
  })
})

describe('duplicate suggestion (CUS-004)', () => {
  it('suggests existing customers with the same phone in any format, excluding archived and self', async () => {
    const sale = createCustomerService(await clientFor(TEST_USERS.sale))
    const similar = await sale.findSimilar({ phone: '+84 90 000 0001' })
    expect(similar.map((c) => c.name).sort()).toEqual([
      'Nguyễn V. Test (trùng SĐT)',
      'Nguyễn Văn Test',
    ])

    expect(await sale.findSimilar({ phone: '0900000006' })).toHaveLength(0) // archived

    const first = similar[0]
    const withoutSelf = await sale.findSimilar({ phone: '0900000001', excludeId: first?.id })
    expect(withoutSelf.map((c) => c.id)).not.toContain(first?.id)
  })

  it('matches by tax code and ignores short or empty phones', async () => {
    const sale = createCustomerService(await clientFor(TEST_USERS.sale))
    expect((await sale.findSimilar({ taxCode: '0100000001' })).map((c) => c.company_name)).toEqual([
      'Công ty TNHH Test ABC',
    ])
    expect(await sale.findSimilar({ phone: '123' })).toHaveLength(0)
    expect(await sale.findSimilar({})).toHaveLength(0)
    expect(await sale.findSimilar({ phone: '', taxCode: '  ' })).toHaveLength(0)
  })
})
