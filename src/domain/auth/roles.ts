/**
 * Approved role codes and permission matrix (TECH_DESIGN §2).
 * Pure data + helpers. This is a UI hint: authorization is enforced by RLS/RPC in the database.
 * Keep in sync with the `roles` seed migration (checked by tests/integration/roles.test.ts).
 */
export const ROLE_CODES = [
  'ADMIN',
  'SALE_B2B',
  'STORE_STAFF',
  'FRANCHISE_STAFF',
  'WAREHOUSE',
  'PRODUCTION',
] as const
export type RoleCode = (typeof ROLE_CODES)[number]

/** `true` = allowed; `'rule'` = allowed within commission/discount rules (e.g. discount ceiling). */
export type PermissionGrant = true | 'rule'

const SALES_ROLES = ['SALE_B2B', 'STORE_STAFF', 'FRANCHISE_STAFF'] as const

type Matrix = Record<string, Partial<Record<RoleCode, PermissionGrant>>>

function grant(roles: readonly RoleCode[], value: PermissionGrant = true) {
  return Object.fromEntries(roles.map((role) => [role, value])) as Partial<
    Record<RoleCode, PermissionGrant>
  >
}

const ALL_ROLES = ROLE_CODES
const ADMIN_ONLY = ['ADMIN'] as const

export const PERMISSION_MATRIX = {
  create_order: grant(['ADMIN', ...SALES_ROLES]),
  view_own_orders: grant(['ADMIN', ...SALES_ROLES]),
  view_all_orders: grant(ADMIN_ONLY),
  edit_price_discount: { ...grant(ADMIN_ONLY), ...grant(SALES_ROLES, 'rule') },
  void_order: grant(ADMIN_ONLY),
  confirm_payment: grant(ADMIN_ONLY),
  view_system_inventory: grant(ALL_ROLES),
  adjust_inventory: grant(ADMIN_ONLY),
  propose_transfer: grant(['ADMIN', ...SALES_ROLES, 'WAREHOUSE']),
  approve_transfer: grant(ADMIN_ONLY),
  confirm_transfer_movement: grant(['ADMIN', 'WAREHOUSE']),
  view_production_plan: grant(['ADMIN', 'WAREHOUSE', 'PRODUCTION']),
  update_production: grant(['ADMIN', 'PRODUCTION']),
  view_own_commission: grant(['ADMIN', ...SALES_ROLES]),
  view_all_commission: grant(ADMIN_ONLY),
  manage_settings: grant(ADMIN_ONLY),
  manage_master_data: grant(ADMIN_ONLY),
  view_audit_log: grant(ADMIN_ONLY),
} as const satisfies Matrix

export type Permission = keyof typeof PERMISSION_MATRIX

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === 'string' && (ROLE_CODES as readonly string[]).includes(value)
}

/** Returns the grant for a role, or `undefined` when the role does not have the permission. */
export function getPermissionGrant(
  role: RoleCode,
  permission: Permission,
): PermissionGrant | undefined {
  const row: Partial<Record<RoleCode, PermissionGrant>> = PERMISSION_MATRIX[permission]
  return row[role]
}

export function hasPermission(role: RoleCode, permission: Permission): boolean {
  return getPermissionGrant(role, permission) !== undefined
}

/** The `roles.permissions` JSON for a role: `{ permission: true | "rule" }`. */
export function permissionsForRole(role: RoleCode): Record<string, PermissionGrant> {
  const result: Record<string, PermissionGrant> = {}
  for (const permission of Object.keys(PERMISSION_MATRIX) as Permission[]) {
    const value = getPermissionGrant(role, permission)
    if (value !== undefined) result[permission] = value
  }
  return result
}
