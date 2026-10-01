/**
 * Date helpers. Calendar dates (no time of day) travel as "YYYY-MM-DD" strings and are formatted
 * by string manipulation so the viewer's time zone can never shift the day.
 */
export function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate
  return `${match[3]}/${match[2]}/${match[1]}`
}
