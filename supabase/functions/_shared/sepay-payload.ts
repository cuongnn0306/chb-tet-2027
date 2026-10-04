/**
 * Payload checks that must happen before the database sees the event (PAY-007). Pure code, shared by
 * the Edge Function and its unit tests. All business rules stay in process_sepay_webhook().
 */

/**
 * A JSON number id has already been parsed into a double by the time it reaches this code, so an
 * integer beyond 2^53 may have silently changed value (two different transactions could collapse
 * into one dedup key). Such numeric ids are refused; the same value sent as a digit string is fine
 * because strings are never rounded.
 */
export function hasRepresentableId(payload: Record<string, unknown>): boolean {
  const id = payload.id
  if (typeof id === 'number') return Number.isSafeInteger(id)
  return true
}
