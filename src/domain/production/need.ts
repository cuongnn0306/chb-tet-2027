/**
 * Production need calculator (PRD-002; IMPLEMENTATION_INFRA_PLAN E09, PRD §B18, TECH_DESIGN §3.17).
 *
 *   suggested = max(0, committed demand + safety target - available - scheduled production)
 *
 * Pure arithmetic on four quantities that are already aggregated by the caller (PRD-001 will supply the committed
 * demand). It reads and writes nothing. Invalid input is reported, never coerced: no rounding, no clamping to zero,
 * no parsing of strings.
 */

export const PRODUCTION_NEED_FIELDS = [
  'committedDemand',
  'safetyTarget',
  'available',
  'scheduled',
] as const
export type ProductionNeedField = (typeof PRODUCTION_NEED_FIELDS)[number]

export type ProductionNeedInput = Record<ProductionNeedField, number>

export type ProductionNeedIssueCode =
  /** Not a `number` (string, null, undefined, ...), NaN or ±Infinity. */
  | 'NOT_A_NUMBER'
  | 'NOT_INTEGER'
  /** Negative, including negative zero. */
  | 'NEGATIVE'
  /** An integer beyond `Number.MAX_SAFE_INTEGER`, which can no longer be added exactly. */
  | 'UNSAFE_INTEGER'
  /** Both inputs are fine but `committedDemand + safetyTarget` or `available + scheduled` leaves the safe range. */
  | 'SUM_OVERFLOW'

export interface ProductionNeedIssue {
  field: ProductionNeedField | 'requirement' | 'supply'
  code: ProductionNeedIssueCode
}

export type ProductionNeedResult =
  | {
      ok: true
      /** Units to propose for production; 0 when supply already covers the requirement. */
      suggestedQty: number
      /** committedDemand + safetyTarget */
      requirement: number
      /** available + scheduled */
      supply: number
    }
  | { ok: false; issues: ProductionNeedIssue[] }

function inputIssue(value: unknown): ProductionNeedIssueCode | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'NOT_A_NUMBER'
  if (!Number.isInteger(value)) return 'NOT_INTEGER'
  if (!Number.isSafeInteger(value)) return 'UNSAFE_INTEGER'
  if (value < 0 || Object.is(value, -0)) return 'NEGATIVE'
  return null
}

/**
 * Returns the suggested production quantity, or every problem found with the input (all four fields are checked so
 * a screen can flag them together). A shortage that would need more than the safe-integer range is reported as
 * `SUM_OVERFLOW`, never as a wrapped or imprecise number.
 */
export function calculateProductionNeed(input: ProductionNeedInput): ProductionNeedResult {
  const issues: ProductionNeedIssue[] = []
  for (const field of PRODUCTION_NEED_FIELDS) {
    const code = inputIssue((input as Partial<Record<ProductionNeedField, unknown>>)[field])
    if (code) issues.push({ field, code })
  }
  if (issues.length > 0) return { ok: false, issues }

  const requirement = input.committedDemand + input.safetyTarget
  const supply = input.available + input.scheduled
  if (!Number.isSafeInteger(requirement))
    issues.push({ field: 'requirement', code: 'SUM_OVERFLOW' })
  if (!Number.isSafeInteger(supply)) issues.push({ field: 'supply', code: 'SUM_OVERFLOW' })
  if (issues.length > 0) return { ok: false, issues }

  return { ok: true, suggestedQty: Math.max(0, requirement - supply), requirement, supply }
}
