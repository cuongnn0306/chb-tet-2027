/**
 * Phone normalisation (CUS-003). Used to search and suggest customers, never as a unique key.
 * Keep identical to the SQL function public.normalize_phone() (parity checked by an integration test).
 *
 * Digits only, with the Vietnamese country code folded to the domestic leading 0:
 * "+84 90 123 4567", "0084901234567", "84901234567" and "090.123.4567" -> "0901234567".
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits === '') return null
  if (digits.startsWith('0084') && digits.length >= 13 && digits.length <= 14) {
    return `0${digits.slice(4)}`
  }
  if (digits.startsWith('84') && digits.length >= 11 && digits.length <= 12) {
    return `0${digits.slice(2)}`
  }
  return digits
}

/** Loose sanity check on a normalised number (9–11 digits, domestic leading 0). */
export function isPlausiblePhone(raw: string): boolean {
  const normalized = normalizePhone(raw)
  return normalized !== null && /^0\d{8,10}$/.test(normalized)
}

/** Minimum digits before a phone is used to look for duplicates (matches the SQL function). */
export const MIN_DUPLICATE_PHONE_LENGTH = 8
