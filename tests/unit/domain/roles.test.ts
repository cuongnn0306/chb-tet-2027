import { describe, expect, it } from 'vitest'
import {
  ROLE_CODES,
  getPermissionGrant,
  hasPermission,
  isRoleCode,
  permissionsForRole,
} from '@/domain/auth/roles'

describe('roles', () => {
  it('has exactly the six approved role codes', () => {
    expect([...ROLE_CODES]).toEqual([
      'ADMIN',
      'SALE_B2B',
      'STORE_STAFF',
      'FRANCHISE_STAFF',
      'WAREHOUSE',
      'PRODUCTION',
    ])
  })

  it('validates role codes', () => {
    expect(isRoleCode('ADMIN')).toBe(true)
    expect(isRoleCode('admin')).toBe(false)
    expect(isRoleCode(undefined)).toBe(false)
  })
})

describe('permission matrix (TECH_DESIGN §2.2)', () => {
  it('lets only Admin void orders, confirm payments, adjust stock, see audit and settings', () => {
    for (const permission of [
      'void_order',
      'confirm_payment',
      'adjust_inventory',
      'view_audit_log',
      'manage_settings',
      'view_all_orders',
      'view_all_commission',
      'approve_transfer',
    ] as const) {
      for (const role of ROLE_CODES) {
        expect(hasPermission(role, permission)).toBe(role === 'ADMIN')
      }
    }
  })

  it('restricts price/discount edits to rules for sales roles and denies others', () => {
    expect(getPermissionGrant('ADMIN', 'edit_price_discount')).toBe(true)
    expect(getPermissionGrant('SALE_B2B', 'edit_price_discount')).toBe('rule')
    expect(getPermissionGrant('STORE_STAFF', 'edit_price_discount')).toBe('rule')
    expect(getPermissionGrant('FRANCHISE_STAFF', 'edit_price_discount')).toBe('rule')
    expect(hasPermission('WAREHOUSE', 'edit_price_discount')).toBe(false)
    expect(hasPermission('PRODUCTION', 'edit_price_discount')).toBe(false)
  })

  it('lets every role view system inventory', () => {
    for (const role of ROLE_CODES) expect(hasPermission(role, 'view_system_inventory')).toBe(true)
  })

  it('keeps warehouse and production out of order and commission screens', () => {
    for (const role of ['WAREHOUSE', 'PRODUCTION'] as const) {
      expect(hasPermission(role, 'create_order')).toBe(false)
      expect(hasPermission(role, 'view_own_orders')).toBe(false)
      expect(hasPermission(role, 'view_own_commission')).toBe(false)
    }
  })

  it('scopes transfer and production permissions', () => {
    expect(hasPermission('WAREHOUSE', 'propose_transfer')).toBe(true)
    expect(hasPermission('PRODUCTION', 'propose_transfer')).toBe(false)
    expect(hasPermission('WAREHOUSE', 'confirm_transfer_movement')).toBe(true)
    expect(hasPermission('STORE_STAFF', 'confirm_transfer_movement')).toBe(false)
    expect(hasPermission('WAREHOUSE', 'view_production_plan')).toBe(true)
    expect(hasPermission('WAREHOUSE', 'update_production')).toBe(false)
    expect(hasPermission('PRODUCTION', 'update_production')).toBe(true)
  })

  it('serialises permissions per role', () => {
    expect(permissionsForRole('PRODUCTION')).toEqual({
      view_system_inventory: true,
      view_production_plan: true,
      update_production: true,
    })
    expect(Object.keys(permissionsForRole('ADMIN'))).toHaveLength(18)
  })
})
