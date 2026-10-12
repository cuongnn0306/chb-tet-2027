/**
 * `payment_events.payload` is untrusted jsonb (a gateway webhook body), whatever the TypeScript
 * declaration says. These guards turn it into values that are safe to render: nothing here throws,
 * and a malformed amount is reported as `null` instead of being shown as 0 or NaN.
 * The server stays the authority; this only decides what the review screen may display or offer.
 */

/** Same ceiling as the server rule: 13 digits of whole VND (`^[0-9]{1,13}$`). */
const MAX_TRANSFER_AMOUNT = 9_999_999_999_999

export const REVIEW_TEXT_FALLBACK = '—'

export interface PaymentReviewView {
  /** Positive integer VND, or null when the payload amount is missing or malformed. */
  amount: number | null
  gateway: string
  content: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Non-blank string, trimmed; anything else (number, object, array, null) is ignored. */
function pickText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text === '' ? null : text
}

/** Mirrors the server: a positive whole number of VND, not a string, float, NaN or Infinity. */
export function readTransferAmount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null
  return value > 0 && value <= MAX_TRANSFER_AMOUNT ? value : null
}

export function readPaymentReviewPayload(
  payload: unknown,
  providerFallback: string,
): PaymentReviewView {
  const data = asRecord(payload)
  return {
    amount: readTransferAmount(data.transferAmount),
    gateway: pickText(data.gateway) ?? providerFallback,
    content: pickText(data.content) ?? pickText(data.description) ?? REVIEW_TEXT_FALLBACK,
  }
}
