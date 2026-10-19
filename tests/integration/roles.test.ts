import { describe, expect, it } from 'vitest'
import { ROLE_CODES, permissionsForRole } from '@/domain/auth/roles'
import { serviceClient } from './helpers'

describe('roles table (AUTH-003)', () => {
  it('contains exactly the approved roles with permissions matching the code matrix', async () => {
    const { data, error } = await serviceClient().from('roles').select('code, permissions')
    expect(error).toBeNull()
    expect(data?.map((r) => r.code).sort()).toEqual([...ROLE_CODES].sort())
    for (const row of data ?? []) {
      expect(row.permissions).toEqual(permissionsForRole(row.code))
    }
  })

  it('rejects unknown role codes', async () => {
    const { error } = await serviceClient().from('roles').insert({ code: 'HACKER', name: 'x' })
    expect(error).not.toBeNull()
  })
})
