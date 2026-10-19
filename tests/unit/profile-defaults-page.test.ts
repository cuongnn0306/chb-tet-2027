import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { ProfileDefaultsPage } from '@/features/profiles/ProfileDefaultsPage'

const state = vi.hoisted(() => ({ role: 'WAREHOUSE', status: 'active', client: vi.fn() }))
vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({ access: { status: state.status, user: { id: 'test', roleCode: state.role } } }),
}))
vi.mock('@/lib/supabase', () => ({ getSupabase: state.client }))
beforeEach(() => {
  state.client.mockClear()
  state.status = 'active'
})
it.each(['WAREHOUSE', 'SALE_B2B', 'STORE_STAFF', 'FRANCHISE_STAFF', 'PRODUCTION'])(
  'denies %s without initializing profile data',
  (role) => {
    state.role = role
    expect(renderToStaticMarkup(createElement(ProfileDefaultsPage))).toContain(
      'Bạn chưa có quyền truy cập',
    )
    expect(state.client).not.toHaveBeenCalled()
  },
)
it('denies an inactive Admin session before loading data', () => {
  state.role = 'ADMIN'
  state.status = 'inactive'
  expect(renderToStaticMarkup(createElement(ProfileDefaultsPage))).toContain(
    'Bạn chưa có quyền truy cập',
  )
  expect(state.client).not.toHaveBeenCalled()
})
