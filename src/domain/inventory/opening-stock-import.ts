import { isIsoDate } from '@/domain/master-data/validation'

/**
 * Parses opening-stock data pasted from Excel (tab-separated) or exported as CSV (comma or semicolon).
 * Template (plan §20): Location Code | SKU | Batch | NSX | HSD | Qty
 * Pure and dependency-free; the database re-validates everything before applying.
 */
export type ImportRow = {
  location_code: string
  sku: string
  batch_code: string
  manufactured_date: string
  expiry_date: string
  quantity: number
}

export interface ParseIssue {
  /** 1-based line number in the pasted text (the header counts as line 1 when present). */
  line: number
  message: string
}

export interface ParsedImport {
  rows: ImportRow[]
  /** Source line of each row, aligned with `rows`, so server errors can point back to the file. */
  lines: number[]
  issues: ParseIssue[]
}

export const IMPORT_HEADER = ['Location Code', 'SKU', 'Batch', 'NSX', 'HSD', 'Qty'] as const

export const IMPORT_TEMPLATE = `${IMPORT_HEADER.join(',')}\nHN-BEP,TT-1200,B-2027-01,01/01/2027,01/03/2027,100\n`

function detectDelimiter(headerLine: string): string {
  if (headerLine.includes('\t')) return '\t'
  const semicolons = headerLine.split(';').length
  const commas = headerLine.split(',').length
  return semicolons > commas ? ';' : ','
}

/** Splits one line honouring double-quoted fields ("a, b" stays one cell, "" is a quote). */
export function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (char === '"') quoted = false
      else current += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) {
      cells.push(current)
      current = ''
    } else current += char
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

/** dd/MM/yyyy, d/M/yyyy, dd-MM-yyyy or yyyy-MM-dd -> yyyy-MM-dd, or null when not a real date. */
export function parseImportDate(raw: string): string | null {
  const text = raw.trim()
  let iso: string | null = null
  const vn = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text)
  if (vn) iso = `${vn[3]}-${vn[2]?.padStart(2, '0')}-${vn[1]?.padStart(2, '0')}`
  else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) iso = text
  return iso && isIsoDate(iso) ? iso : null
}

/** "1200", "1.200" or "1,200" -> 1200 (whole numbers only). */
export function parseImportQuantity(raw: string): number | null {
  const text = raw.replace(/\s/g, '')
  if (/^\d+$/.test(text)) return Number(text)
  if (/^\d{1,3}([.,]\d{3})+$/.test(text)) return Number(text.replace(/[.,]/g, ''))
  return null
}

const HEADER_HINTS = ['location', 'sku', 'batch', 'qty', 'địa điểm', 'lô']

function looksLikeHeader(cells: string[]): boolean {
  const first = (cells[0] ?? '').toLowerCase()
  return HEADER_HINTS.some((hint) => first.includes(hint)) && !/\d{4}/.test(cells.join(' '))
}

export function parseOpeningStockText(text: string): ParsedImport {
  const result: ParsedImport = { rows: [], lines: [], issues: [] }
  const rawLines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const firstContent = rawLines.findIndex((line) => line.trim() !== '')
  if (firstContent < 0) {
    result.issues.push({
      line: 1,
      message: 'Chưa có dữ liệu. Hãy dán từ Excel hoặc chọn file CSV.',
    })
    return result
  }

  const delimiter = detectDelimiter(rawLines[firstContent] ?? '')
  rawLines.forEach((line, index) => {
    if (line.trim() === '') return
    const lineNo = index + 1
    const cells = splitLine(line, delimiter)
    if (index === firstContent && looksLikeHeader(cells)) return

    if (cells.length < 6) {
      result.issues.push({
        line: lineNo,
        message: `Cần đủ 6 cột (${IMPORT_HEADER.join(' | ')}), dòng này có ${cells.length}.`,
      })
      return
    }
    const [location, sku, batch, mfdRaw, expRaw, qtyRaw] = cells as [
      string,
      string,
      string,
      string,
      string,
      string,
    ]
    const problems: string[] = []
    if (location === '') problems.push('thiếu mã địa điểm')
    if (sku === '') problems.push('thiếu SKU')
    if (batch === '') problems.push('thiếu mã lô')
    const mfd = parseImportDate(mfdRaw)
    const exp = parseImportDate(expRaw)
    if (!mfd) problems.push(`ngày sản xuất "${mfdRaw}" không hợp lệ (dùng dd/MM/yyyy)`)
    if (!exp) problems.push(`hạn sử dụng "${expRaw}" không hợp lệ (dùng dd/MM/yyyy)`)
    const quantity = parseImportQuantity(qtyRaw)
    if (quantity === null || quantity < 1)
      problems.push(`số lượng "${qtyRaw}" phải là số nguyên từ 1`)

    if (problems.length > 0) {
      result.issues.push({ line: lineNo, message: problems.join('; ') + '.' })
      return
    }
    result.rows.push({
      location_code: location.toUpperCase(),
      sku: sku.toUpperCase(),
      batch_code: batch.toUpperCase(),
      manufactured_date: mfd as string,
      expiry_date: exp as string,
      quantity: quantity as number,
    })
    result.lines.push(lineNo)
  })

  if (result.rows.length === 0 && result.issues.length === 0) {
    result.issues.push({ line: 1, message: 'Không có dòng dữ liệu nào ngoài dòng tiêu đề.' })
  }
  return result
}
