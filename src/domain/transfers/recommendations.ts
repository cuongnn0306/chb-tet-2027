/**
 * TRF-002: when may the request screen ask for source recommendations, and for exactly which inputs.
 * No ranking and no stock arithmetic here: the order and the numbers come from `suggest_transfer_sources()`.
 */
import type { AccessState } from '@/domain/auth/access'
import type { RoleCode } from '@/domain/auth/roles'
import { canProposeTransfer, parseTransferQuantity } from './transfers'

export interface RecommendationFormInput {
  destinationLocationId: string
  productId: string
  /** The quantity box exactly as typed. */
  quantityText: string
}

/** Everything a recommendation result depends on; used verbatim as the query identity. */
export interface RecommendationQuery {
  userId: string
  roleCode: RoleCode
  destinationLocationId: string
  productId: string
  quantity: number
}

/**
 * Returns the query to run, or null when no request may be made: not an active signed-in user, a role without
 * `propose_transfer`, or a missing destination / SKU / quantity that is not a whole number within bounds.
 */
export function resolveRecommendationQuery(
  access: AccessState,
  form: RecommendationFormInput,
): RecommendationQuery | null {
  if (access.status !== 'active') return null
  if (!canProposeTransfer(access.user.roleCode)) return null
  if (!form.destinationLocationId || !form.productId) return null
  const quantity = parseTransferQuantity(form.quantityText)
  if (quantity === null) return null
  return {
    userId: access.user.id,
    roleCode: access.user.roleCode,
    destinationLocationId: form.destinationLocationId,
    productId: form.productId,
    quantity,
  }
}
