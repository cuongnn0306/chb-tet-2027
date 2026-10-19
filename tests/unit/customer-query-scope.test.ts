import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { customerQueryScope } from '@/domain/customers/query-scope'
import type { AccessState } from '@/domain/auth/access'

function active(id: string, roleCode: 'ADMIN' | 'STORE_STAFF' = 'ADMIN'): AccessState {
  return {
    status: 'active',
    user: {
      id,
      roleCode,
      fullName: id,
      isActive: true,
      roleName: roleCode,
      defaultLocationId: null,
      defaultSalesChannelId: null,
      defaultLeadSourceId: null,
    },
  }
}
it('does not serve Admin cached rows to a different user or changed role', () => {
  const cache = new QueryClient()
  for (const family of ['customers', 'customer-picker', 'customer-history', 'similar-customers']) {
    cache.setQueryData(
      [family, customerQueryScope(active('admin')), 'same-filter'],
      ['private-row'],
    )
    expect(
      cache.getQueryData([
        family,
        customerQueryScope(active('store', 'STORE_STAFF')),
        'same-filter',
      ]),
    ).toBeUndefined()
    expect(
      cache.getQueryData([
        family,
        customerQueryScope(active('admin', 'STORE_STAFF')),
        'same-filter',
      ]),
    ).toBeUndefined()
  }
  cache.clear()
})
it('drops previous-account rows immediately while the next query is unresolved', () => {
  const cache = new QueryClient()
  const key = (id: string) => ['customers', customerQueryScope(active(id))]
  cache.setQueryData(key('first'), ['first-account-row'])
  const observer = new QueryObserver(cache, { queryKey: key('first'), enabled: false })
  const unsubscribe = observer.subscribe(() => {})
  expect(observer.getCurrentResult().data).toEqual(['first-account-row'])
  observer.setOptions({ queryKey: key('second'), queryFn: () => new Promise<string[]>(() => {}) })
  expect(observer.getCurrentResult().data).toBeUndefined()
  expect(observer.getCurrentResult().isPending).toBe(true)
  unsubscribe()
  cache.clear()
})
it('non-active access has no data-query scope', () => {
  for (const access of [
    { status: 'signed_out' },
    { status: 'loading' },
    { status: 'no_profile' },
    { status: 'inactive', fullName: 'Inactive' },
  ] as AccessState[])
    expect(customerQueryScope(access)).toBeNull()
})
