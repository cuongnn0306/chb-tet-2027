import { describe, expect, it } from 'vitest'
import type { AccessState, ActiveUser } from '@/domain/auth/access'
import { ROLE_CODES, type RoleCode } from '@/domain/auth/roles'
import {
  AUDIT_MAX_PAGE,
  AUDIT_MAX_PAGE_SIZE,
  AUDIT_PAYLOAD_MAX_CHARS,
  AuditQueryError,
  REDACTED_VALUE,
  assertAuditPage,
  assertAuditPageSize,
  describeAuditActor,
  formatAuditPayload,
  parseAuditFilters,
  redactAuditPayload,
  resolveAuditViewerAccess,
} from '@/domain/audit/audit-log'

const UUID = '3f2b8c1e-5a47-4d0e-9b61-0c2f7a9d4e11'

function activeUser(roleCode: RoleCode, id = UUID): ActiveUser {
  return {
    id,
    fullName: 'Người dùng thử',
    isActive: true,
    roleCode,
    roleName: null,
    defaultLocationId: null,
    defaultSalesChannelId: null,
    defaultLeadSourceId: null,
  }
}

describe('parseAuditFilters', () => {
  it('accepts an empty filter set', () => {
    expect(parseAuditFilters({})).toEqual({ ok: true, filters: {} })
    expect(parseAuditFilters({ entityType: ' ', action: '', dateFrom: '' })).toEqual({
      ok: true,
      filters: {},
    })
  })

  it('keeps recorded identifiers exactly, trimming only surrounding spaces', () => {
    const result = parseAuditFilters({
      entityType: ' inventory_movements ',
      action: 'payment.event:resolved-v2',
    })
    expect(result).toEqual({
      ok: true,
      filters: { entityType: 'inventory_movements', action: 'payment.event:resolved-v2' },
    })
  })

  it.each([
    'a,b',
    'x)or(1.eq.1',
    'a.eq.b,or(c.eq.d)',
    'a b',
    '"quoted"',
    '*',
    'a&b=c',
    'a%20b',
    "'; drop table audit_logs; --",
    '<script>',
    'đơn',
  ])('rejects filter-grammar or markup shaped text %j', (value) => {
    for (const key of ['entityType', 'action'] as const) {
      const result = parseAuditFilters({ [key]: value })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors[key]).toMatch(/\S/)
    }
  })

  it('rejects over-long identifiers', () => {
    expect(parseAuditFilters({ action: 'a'.repeat(64) }).ok).toBe(true)
    expect(parseAuditFilters({ action: 'a'.repeat(65) }).ok).toBe(false)
  })

  it('requires uuids for actor and record id and lower-cases them', () => {
    const upper = UUID.toUpperCase()
    expect(parseAuditFilters({ actorUserId: upper, entityId: upper })).toEqual({
      ok: true,
      filters: { actorUserId: UUID, entityId: UUID },
    })
    for (const bad of ['1', 'not-a-uuid', `${UUID},x`, `${UUID}) or (true`, UUID.slice(1)]) {
      const result = parseAuditFilters({ actorUserId: bad, entityId: bad })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.actorUserId).toBeDefined()
        expect(result.errors.entityId).toBeDefined()
      }
    }
  })

  it('turns inclusive Vietnam days into an exclusive UTC window', () => {
    const result = parseAuditFilters({ dateFrom: '2027-01-05', dateTo: '2027-01-05' })
    expect(result).toEqual({
      ok: true,
      filters: {
        // 00:00 UTC+7 on the 5th is 17:00 UTC on the 4th.
        createdFrom: '2027-01-04T17:00:00.000Z',
        createdBefore: '2027-01-05T17:00:00.000Z',
      },
    })
  })

  it('handles month and year boundaries and leap days', () => {
    const result = parseAuditFilters({ dateFrom: '2027-12-31', dateTo: '2028-02-29' })
    expect(result).toEqual({
      ok: true,
      filters: {
        createdFrom: '2027-12-30T17:00:00.000Z',
        createdBefore: '2028-02-29T17:00:00.000Z',
      },
    })
  })

  it('accepts a single open-ended side', () => {
    expect(parseAuditFilters({ dateFrom: '2027-01-05' })).toEqual({
      ok: true,
      filters: { createdFrom: '2027-01-04T17:00:00.000Z' },
    })
    expect(parseAuditFilters({ dateTo: '2027-01-05' })).toEqual({
      ok: true,
      filters: { createdBefore: '2027-01-05T17:00:00.000Z' },
    })
  })

  it.each(['2027-02-30', '2027-13-01', '2027-00-10', '27-01-01', '2027/01/01', '1999-12-31', 'x'])(
    'rejects the date %j',
    (value) => {
      const result = parseAuditFilters({ dateFrom: value, dateTo: value })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.dateFrom).toBeDefined()
        expect(result.errors.dateTo).toBeDefined()
      }
    },
  )

  it('rejects an inverted range and reports every invalid field at once', () => {
    const inverted = parseAuditFilters({ dateFrom: '2027-01-06', dateTo: '2027-01-05' })
    expect(inverted.ok).toBe(false)
    const many = parseAuditFilters({ entityType: 'a b', actorUserId: 'x', dateFrom: 'y' })
    expect(many.ok).toBe(false)
    if (!many.ok)
      expect(Object.keys(many.errors).sort()).toEqual(['actorUserId', 'dateFrom', 'entityType'])
  })
})

describe('page bounds', () => {
  it('accepts values inside the bounds', () => {
    expect(assertAuditPage(0)).toBe(0)
    expect(assertAuditPage(AUDIT_MAX_PAGE)).toBe(AUDIT_MAX_PAGE)
    expect(assertAuditPageSize(1)).toBe(1)
    expect(assertAuditPageSize(AUDIT_MAX_PAGE_SIZE)).toBe(AUDIT_MAX_PAGE_SIZE)
  })

  it.each([-1, 1.5, Number.NaN, Infinity, AUDIT_MAX_PAGE + 1])('rejects page %s', (value) => {
    expect(() => assertAuditPage(value)).toThrow(AuditQueryError)
  })

  it.each([0, -5, 2.5, Number.NaN, Infinity, AUDIT_MAX_PAGE_SIZE + 1, 1_000_000])(
    'rejects page size %s instead of clamping',
    (value) => {
      expect(() => assertAuditPageSize(value)).toThrow(AuditQueryError)
    },
  )
})

describe('resolveAuditViewerAccess', () => {
  it('lets only an active Admin mount the viewer', () => {
    for (const role of ROLE_CODES) {
      const result = resolveAuditViewerAccess({ status: 'active', user: activeUser(role) })
      if (role === 'ADMIN') expect(result).toEqual({ status: 'allowed', identity: `${UUID}:ADMIN` })
      else expect(result).toEqual({ status: 'denied' })
    }
  })

  it('never allows loading, signed-out, inactive or profile-less states', () => {
    expect(resolveAuditViewerAccess({ status: 'loading' })).toEqual({ status: 'loading' })
    const denied: AccessState[] = [
      { status: 'signed_out' },
      { status: 'no_profile' },
      { status: 'inactive', fullName: 'Nhân viên đã nghỉ' },
    ]
    for (const access of denied) {
      expect(resolveAuditViewerAccess(access)).toEqual({ status: 'denied' })
    }
  })

  it('changes identity when the account or the role changes (forces a remount)', () => {
    const a = resolveAuditViewerAccess({ status: 'active', user: activeUser('ADMIN') })
    const b = resolveAuditViewerAccess({
      status: 'active',
      user: activeUser('ADMIN', '9c1d0000-0000-4000-8000-000000000001'),
    })
    expect(a).not.toEqual(b)
  })
})

describe('describeAuditActor', () => {
  it('does not present a missing actor as a person', () => {
    expect(describeAuditActor(null, null).kind).toBe('system')
    expect(describeAuditActor(null, 'Ai đó').kind).toBe('system')
  })

  it('uses the profile name and falls back to unknown', () => {
    expect(describeAuditActor(UUID, ' Admin Test ')).toEqual({
      kind: 'person',
      label: 'Admin Test',
    })
    expect(describeAuditActor(UUID, null).kind).toBe('unknown')
    expect(describeAuditActor(UUID, '  ').kind).toBe('unknown')
  })
})

describe('payload display', () => {
  it('masks secret-looking keys at every depth without mutating the source', () => {
    const source = {
      name: 'Kho A',
      config: { apiKey: 'abc', nested: [{ password: 'p', ok: 1 }], sepay_secret: 's' },
      Authorization: 'Bearer x',
      hmac_signature: 'sig',
    }
    const snapshot = JSON.stringify(source)
    expect(redactAuditPayload(source)).toEqual({
      name: 'Kho A',
      config: {
        apiKey: REDACTED_VALUE,
        nested: [{ password: REDACTED_VALUE, ok: 1 }],
        sepay_secret: REDACTED_VALUE,
      },
      Authorization: REDACTED_VALUE,
      hmac_signature: REDACTED_VALUE,
    })
    expect(JSON.stringify(source)).toBe(snapshot)
  })

  it('keeps markup as inert text and reports empty columns', () => {
    const markup = { note: '<img src=x onerror=alert(1)>' }
    expect(formatAuditPayload(markup).text).toContain('<img src=x onerror=alert(1)>')
    expect(formatAuditPayload(null)).toEqual({ text: null, truncated: false })
    expect(formatAuditPayload(undefined)).toEqual({ text: null, truncated: false })
  })

  it('caps very large payloads', () => {
    const big = { text: 'x'.repeat(AUDIT_PAYLOAD_MAX_CHARS * 2) }
    const formatted = formatAuditPayload(big)
    expect(formatted.truncated).toBe(true)
    expect(formatted.text).toHaveLength(AUDIT_PAYLOAD_MAX_CHARS)
  })

  it('survives a pathologically deep payload', () => {
    let value: unknown = 'leaf'
    for (let i = 0; i < 200; i += 1) value = { next: value }
    expect(() => formatAuditPayload(value)).not.toThrow()
  })
})
