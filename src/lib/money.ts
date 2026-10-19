/**
 * Money helpers. Money is always an integer number of VND (never floating point).
 * Centralised here so every screen formats and parses the same way.
 */
const vndFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

export function formatVnd(amount: number): string {
  return `${vndFormatter.format(amount)} ₫`
}

export type ParseResult = { value: number; error: null } | { value: null; error: string }

/**
 * Parses what a person types into whole VND: "1200000", "1.200.000" or "1,200,000".
 * Fractions are rejected: VND has no minor unit in this system.
 */
export function parseVnd(raw: string, { label = 'Số tiền' }: { label?: string } = {}): ParseResult {
  const text = raw.replace(/\s/g, '')
  if (text === '') return { value: null, error: `${label} không được để trống.` }

  let digits: string
  if (/^\d+$/.test(text)) digits = text
  else if (/^\d{1,3}([.,]\d{3})+$/.test(text)) digits = text.replace(/[.,]/g, '')
  else return { value: null, error: `${label} phải là số tiền VND nguyên, không có phần lẻ.` }

  const value = Number(digits)
  if (!Number.isSafeInteger(value)) return { value: null, error: `${label} quá lớn.` }
  return { value, error: null }
}
