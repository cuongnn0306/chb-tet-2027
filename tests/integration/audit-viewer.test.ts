import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { AUDIT_MAX_PAGE, AUDIT_MAX_PAGE_SIZE, AuditQueryError } from '@/domain/audit/audit-log'
import type { AppSupabaseClient } from '@/lib/supabase'
import { createAuditService, type AuditService } from '@/services/audit.service'
import { TEST_USERS, anonClient, serviceClient, signedInClient } from './helpers'

/**
 * SEC-001: the read-only Audit Log viewer service over the existing immutable `audit_logs` table.
 * Rows come from real writes (locations changed as Admin, a bulk insert by the service role) so actor,
 * action and payloads are asserted against what the helper actually recorded. Nothing is deleted.
 */

const asApp = (client: SupabaseClient) => client as unknown as AppSupabaseClient

let admin: SupabaseClient
let adminService: AuditService
let adminId: string
/** A location created and then renamed by Admin: two audit rows with a real actor. */
let locationId: string
let updateAuditId: string

const svc = () => serviceClient()

/**
 * `created_at` is a Postgres timestamptz with microsecond precision, and the listing orders by it.
 * `Date.parse` keeps milliseconds only, so two rows written within the same millisecond looked tied
 * to this test while the database had (correctly) ordered them by their microseconds.
 */
function microseconds(value: string): number {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? ''
  const wholeSeconds = Date.parse(value.replace(/\.\d+/, ''))
  return wholeSeconds * 1000 + Number(fraction.padEnd(6, '0').slice(0, 6))
}

/** Vietnam calendar day `offset` days from today, `YYYY-MM-DD`. */
function vietnamDay(offset: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
    new Date(),
  )
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10)
}

beforeAll(async () => {
  admin = await signedInClient(TEST_USERS.admin)
  adminService = createAuditService(asApp(admin))
  const { data: profile } = await svc()
    .from('profiles')
    .select('id')
    .eq('full_name', 'Admin Test')
    .single()
  adminId = profile?.id as string

  const { data: created, error } = await admin
    .from('locations')
    .insert({ code: `AUD-${randomUUID()}`, name: 'Trước', location_type: 'STORE' })
    .select('id')
    .single()
  if (error) throw error
  locationId = created.id as string
  const renamed = await admin.from('locations').update({ name: 'Sau' }).eq('id', locationId)
  if (renamed.error) throw renamed.error

  const { rows } = await adminService.listLogs({
    filters: { entityType: 'locations', entityId: locationId, action: 'update' },
  })
  updateAuditId = rows[0].id
})

describe('Admin reads the audit trail', () => {
  it('returns real actor, action, entity and before/after for a master-data change', async () => {
    const { rows, hasNext } = await adminService.listLogs({
      filters: { entityType: 'locations', entityId: locationId },
    })
    expect(hasNext).toBe(false)
    // Newest first: the rename, then the creation.
    expect(rows.map((r) => r.action)).toEqual(['update', 'insert'])
    for (const row of rows) {
      expect(row.entity_type).toBe('locations')
      expect(row.entity_id).toBe(locationId)
      expect(row.actor_user_id).toBe(adminId)
      expect(row.actor?.full_name).toBe('Admin Test')
      // The helper records no reason unless the transaction sets one.
      expect(row.reason).toBeNull()
      // The list never carries the payload columns.
      expect(row).not.toHaveProperty('before_data')
      expect(row).not.toHaveProperty('after_data')
    }

    // Same rows as the ledger itself (source integrity), compared through the service role.
    const { data: stored } = await svc()
      .from('audit_logs')
      .select('id, actor_user_id, action')
      .eq('entity_type', 'locations')
      .eq('entity_id', locationId)
    expect([...(stored ?? [])].map((r) => r.id).sort()).toEqual(rows.map((r) => r.id).sort())

    const detail = await adminService.getDetail(rows[0].id)
    expect(detail?.before_data).toMatchObject({ name: 'Trước' })
    expect(detail?.after_data).toMatchObject({ name: 'Sau' })
    const created = await adminService.getDetail(rows[1].id)
    expect(created?.before_data).toBeNull()
    expect(created?.after_data).toMatchObject({ name: 'Trước' })
  })

  it('returns null for a detail that does not exist', async () => {
    expect(await adminService.getDetail(randomUUID())).toBeNull()
  })

  it('filters by actor, action, entity type, record id and Vietnam calendar day', async () => {
    const base = { entityType: 'locations', entityId: locationId }
    const count = async (filters: object) =>
      (await adminService.listLogs({ filters: { ...base, ...filters } })).rows.length

    expect(await count({})).toBe(2)
    expect(await count({ actorUserId: adminId })).toBe(2)
    expect(await count({ actorUserId: randomUUID() })).toBe(0)
    expect(await count({ action: 'update' })).toBe(1)
    expect(await count({ action: 'insert' })).toBe(1)
    expect(await count({ action: 'delete' })).toBe(0)
    expect(await count({ entityType: 'products' })).toBe(0)
    // Today (with a day of slack either side so a run across midnight cannot flake) includes both rows.
    expect(await count({ dateFrom: vietnamDay(-1), dateTo: vietnamDay(1) })).toBe(2)
    // A window entirely in the future, or entirely in 2000, includes nothing.
    expect(await count({ dateFrom: vietnamDay(2) })).toBe(0)
    expect(await count({ dateFrom: '2000-01-01', dateTo: '2000-01-02' })).toBe(0)
    expect(await count({ dateTo: '2000-01-02' })).toBe(0)
  })

  it('excludes system rows (no actor) when filtering by a person', async () => {
    // Service-role writes have no auth.uid(): the helper records a NULL actor.
    const systemId = (
      await svc()
        .from('locations')
        .insert({ code: `AUD-SYS-${randomUUID()}`, name: 'Hệ thống', location_type: 'STORE' })
        .select('id')
        .single()
    ).data?.id as string
    const system = await adminService.listLogs({
      filters: { entityType: 'locations', entityId: systemId },
    })
    expect(system.rows).toHaveLength(1)
    expect(system.rows[0].actor_user_id).toBeNull()
    expect(system.rows[0].actor).toBeNull()

    const byPerson = await adminService.listLogs({
      filters: { entityType: 'locations', entityId: systemId, actorUserId: adminId },
    })
    expect(byPerson.rows).toHaveLength(0)
  })

  it('pages deterministically across rows with identical timestamps', async () => {
    // One statement = one transaction = one now(): six audit rows tie on created_at.
    const codes = Array.from({ length: 6 }, () => `AUD-TIE-${randomUUID()}`)
    const { data: inserted, error } = await svc()
      .from('locations')
      .insert(codes.map((code) => ({ code, name: 'Cùng thời điểm', location_type: 'STORE' })))
      .select('id')
    expect(error).toBeNull()
    const tieIds = new Set((inserted ?? []).map((r) => r.id as string))
    expect(tieIds.size).toBe(6)

    const { data: tied } = await svc()
      .from('audit_logs')
      .select('created_at')
      .eq('entity_type', 'locations')
      .in('entity_id', [...tieIds])
    expect(new Set((tied ?? []).map((r) => r.created_at)).size).toBe(1)

    // Walk every page of one small page size.
    const seen: { id: string; created_at: string; entity_id: string | null }[] = []
    let hasNext = true
    for (let page = 0; hasNext; page += 1) {
      expect(page).toBeLessThan(500)
      const result = await adminService.listLogs({
        filters: { entityType: 'locations' },
        page,
        pageSize: 2,
      })
      expect(result.rows.length).toBeLessThanOrEqual(2)
      if (result.hasNext) expect(result.rows).toHaveLength(2)
      seen.push(...result.rows)
      hasNext = result.hasNext
    }

    // No repeats, none missing.
    expect(new Set(seen.map((r) => r.id)).size).toBe(seen.length)
    const { count } = await svc()
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('entity_type', 'locations')
    expect(seen.length).toBe(count)

    // Strictly descending by (created_at, id).
    for (let i = 1; i < seen.length; i += 1) {
      const previous = seen[i - 1]
      const current = seen[i]
      const byTime = microseconds(previous.created_at) - microseconds(current.created_at)
      expect(byTime >= 0).toBe(true)
      if (byTime === 0) expect(previous.id > current.id).toBe(true)
    }
    expect(seen.filter((r) => r.entity_id && tieIds.has(r.entity_id))).toHaveLength(6)
  })

  it('keeps the page size bounded', async () => {
    const defaults = await adminService.listLogs()
    expect(defaults.rows.length).toBeLessThanOrEqual(50)
    const max = await adminService.listLogs({ pageSize: AUDIT_MAX_PAGE_SIZE })
    expect(max.rows.length).toBeLessThanOrEqual(AUDIT_MAX_PAGE_SIZE)

    for (const pageSize of [0, -1, 1.5, AUDIT_MAX_PAGE_SIZE + 1, 100_000, Number.NaN]) {
      await expect(adminService.listLogs({ pageSize })).rejects.toBeInstanceOf(AuditQueryError)
    }
    for (const page of [-1, 0.5, AUDIT_MAX_PAGE + 1, Number.NaN]) {
      await expect(adminService.listLogs({ page })).rejects.toBeInstanceOf(AuditQueryError)
    }
    // A page far past the data is simply empty.
    const past = await adminService.listLogs({ page: 9_000, pageSize: 100 })
    expect(past).toEqual({ rows: [], hasNext: false })
  })

  it('rejects invalid or filter-grammar shaped input before any request is made', async () => {
    const calls: string[] = []
    const spy = {
      from(table: string) {
        calls.push(table)
        throw new Error('no request may be made for invalid input')
      },
    } as unknown as AppSupabaseClient
    const guarded = createAuditService(spy)

    const bad = [
      { entityType: 'locations,or=(id.not.is.null)' },
      { entityType: 'x)or(a.eq.b' },
      { action: 'update%2Cdelete' },
      { action: '*' },
      { actorUserId: "x' or '1'='1" },
      { actorUserId: 'not-a-uuid' },
      { entityId: `${randomUUID()},id.not.is.null` },
      { entityId: '42' },
      { dateFrom: '2027-02-30' },
      { dateFrom: '2027-03-02', dateTo: '2027-03-01' },
      { dateTo: "2027-03-01T00:00:00Z' or 1=1" },
      { entityType: 'a'.repeat(65) },
    ]
    for (const filters of bad) {
      await expect(guarded.listLogs({ filters })).rejects.toBeInstanceOf(AuditQueryError)
    }
    await expect(guarded.getDetail('not-a-uuid')).rejects.toBeInstanceOf(AuditQueryError)
    await expect(guarded.getDetail(`${randomUUID()},x`)).rejects.toBeInstanceOf(AuditQueryError)
    expect(calls).toEqual([])
  })

  it('shows unknown recorded actions and entity types verbatim, markup inert', async () => {
    const entityType = `future_entity.${randomUUID()}`
    const reason = '<img src=x onerror=alert(1)>'
    const { error } = await svc()
      .from('audit_logs')
      .insert({
        entity_type: entityType,
        action: 'new_action:v2',
        reason,
        before_data: { api_secret: 'stored-as-is' },
        after_data: { note: '<b>x</b>' },
      })
    expect(error).toBeNull()

    const { rows } = await adminService.listLogs({
      filters: { entityType, action: 'new_action:v2' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      entity_type: entityType,
      action: 'new_action:v2',
      reason,
      entity_id: null,
      actor_user_id: null,
      actor: null,
    })
    const detail = await adminService.getDetail(rows[0].id)
    // The stored row is returned untouched; masking happens only when it is displayed.
    expect(detail?.before_data).toEqual({ api_secret: 'stored-as-is' })
    expect(detail?.after_data).toEqual({ note: '<b>x</b>' })
  })
})

describe('everyone else reads nothing (RLS is the boundary)', () => {
  it.each(['sale', 'store', 'franchise', 'warehouse', 'production', 'inactive'] as const)(
    '%s',
    async (key) => {
      const service = createAuditService(asApp(await signedInClient(TEST_USERS[key])))
      expect((await service.listLogs()).rows).toEqual([])
      const targeted = await service.listLogs({
        filters: { entityType: 'locations', entityId: locationId },
      })
      expect(targeted).toEqual({ rows: [], hasNext: false })
      expect(await service.getDetail(updateAuditId)).toBeNull()
    },
  )

  it('anonymous clients get no rows or no access at all', async () => {
    const service = createAuditService(asApp(anonClient()))
    const outcome = await service.listLogs().then(
      (page) => page.rows.length,
      () => 'denied',
    )
    expect(outcome === 'denied' || outcome === 0).toBe(true)
    const detail = await service.getDetail(updateAuditId).then(
      (row) => row,
      () => null,
    )
    expect(detail).toBeNull()
  })
})

describe('the trail stays read-only', () => {
  it('exposes no write method', () => {
    expect(Object.keys(adminService).sort()).toEqual(['getDetail', 'listLogs'])
  })

  it('cannot be written, edited or deleted from the client, and nothing changes', async () => {
    const { count: before } = await svc()
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
    const { data: original } = await svc()
      .from('audit_logs')
      .select('*')
      .eq('id', updateAuditId)
      .single()

    const insert = await admin
      .from('audit_logs')
      .insert({ entity_type: 'locations', action: 'insert', reason: 'giả mạo' })
    expect(insert.error).not.toBeNull()
    const update = await admin
      .from('audit_logs')
      .update({ action: 'tampered', reason: 'sửa' })
      .eq('id', updateAuditId)
      .select()
    expect(update.error !== null || (update.data ?? []).length === 0).toBe(true)
    const del = await admin.from('audit_logs').delete().eq('id', updateAuditId).select()
    expect(del.error !== null || (del.data ?? []).length === 0).toBe(true)

    const { count: after } = await svc()
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
    expect(after).toBe(before)
    const { data: unchanged } = await svc()
      .from('audit_logs')
      .select('*')
      .eq('id', updateAuditId)
      .single()
    expect(unchanged).toEqual(original)
  })
})
