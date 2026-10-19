/** Calendar dates are business dates, so all month arithmetic uses UTC. */
function monthParts(month: string): { year: number; number: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month)
  if (!match) throw new Error('Invalid calendar month')
  return { year: Number(match[1]), number: Number(match[2]) }
}

export function monthBounds(month: string): { from: string; to: string } {
  const { year, number } = monthParts(month)
  const from = `${year}-${String(number).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate()
  return { from, to: `${year}-${String(number).padStart(2, '0')}-${lastDay}` }
}

export function shiftMonth(month: string, offset: number): string {
  const { year, number } = monthParts(month)
  const date = new Date(Date.UTC(year, number - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthGrid(month: string): (string | null)[] {
  const { from, to } = monthBounds(month)
  const firstWeekday = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7
  const days = Number(to.slice(-2))
  const cells: (string | null)[] = Array(firstWeekday).fill(null)
  for (let day = 1; day <= days; day++) {
    cells.push(`${month}-${String(day).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function monthLabel(month: string): string {
  const { year, number } = monthParts(month)
  return `Tháng ${number}/${year}`
}
