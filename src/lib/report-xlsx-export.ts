/**
 * Generic XLSX export engine (RPT-012).
 *
 * It serializes exactly the rows its caller passes in: it never fetches data, never applies a
 * date/location/user/channel policy and never computes a KPI. The caller (a future report query)
 * owns authorization and filtering; the engine only records a filter snapshot for traceability.
 * Money is integer VND and is written as a real number cell, never as a float or a string.
 */
// The package ships typings (index.d.ts) that its `exports` map hides from TypeScript, and its ESM
// build only has a default export. Type just the surface used here instead of widening tsconfig.
// @ts-expect-error TS7016: typings not resolvable through package.json "exports"
import ExcelJSModule from '@excel.js/exceljs'

interface ExcelWorksheetLike {
  columns: unknown
  views: unknown
  addRow(values: readonly unknown[]): { font: unknown }
  getRow(index: number): { font: unknown }
}
interface ExcelWorkbookLike {
  addWorksheet(name: string): ExcelWorksheetLike
  xlsx: { writeBuffer(): Promise<ArrayBufferLike> }
}
const ExcelJS = ExcelJSModule as { Workbook: new () => ExcelWorkbookLike }

/** Excel hard limits (xlsx format). The header occupies row 1 of the data sheet. */
export const XLSX_MAX_ROWS = 1_048_576
export const XLSX_MAX_DATA_ROWS = XLSX_MAX_ROWS - 1
export const XLSX_MAX_COLUMNS = 16_384
export const XLSX_MAX_CELL_CHARS = 32_767
export const XLSX_MAX_SHEET_NAME_CHARS = 31

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** `vnd` and `integer` cells only accept safe integers (negative allowed for adjustments/returns). */
export type XlsxColumnType = 'text' | 'vnd' | 'integer'

export type XlsxCellValue = string | number | null

export interface XlsxColumn {
  /** Property read from every row. Must be unique. */
  key: string
  /** Vietnamese header shown in row 1. Must be unique so two measures can never be merged. */
  header: string
  type: XlsxColumnType
  /** Width in characters; optional. */
  width?: number
}

export interface XlsxFilterEntry {
  label: string
  value: string
}

export interface XlsxExportInput {
  /** Data sheet name (Excel rules: max 31 chars, none of []:*?/\). */
  sheetName: string
  /** Base of the download name; sanitized. The `.xlsx` extension is added by the engine. */
  filenameBase: string
  columns: readonly XlsxColumn[]
  /** Already-authorized, already-filtered rows. Every column key must be present (null = blank). */
  rows: readonly Readonly<Record<string, XlsxCellValue>>[]
  /** Human-readable snapshot of the filters the caller applied. Written to the "Bộ lọc" sheet. */
  filters: readonly XlsxFilterEntry[]
  /** Optional caller-supplied export time (kept out of the engine so output stays deterministic). */
  exportedAtLabel?: string
}

export interface XlsxExportResult {
  buffer: Uint8Array
  filename: string
  mimeType: typeof XLSX_MIME_TYPE
  rowCount: number
}

export type XlsxExportErrorCode =
  'invalid_sheet_name' | 'invalid_columns' | 'too_many_columns' | 'too_many_rows' | 'invalid_value'

export class XlsxExportError extends Error {
  readonly code: XlsxExportErrorCode
  constructor(code: XlsxExportErrorCode, message: string) {
    super(message)
    this.name = 'XlsxExportError'
    this.code = code
  }
}

export const FILTER_SHEET_NAME = 'Bộ lọc'

// XML 1.0 forbids these control characters; exceljs would otherwise emit a corrupt package.
// eslint-disable-next-line no-control-regex
const XML_INVALID_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g
// A cell starting with these is interpreted as a formula by Excel/Sheets/LibreOffice when pasted or
// re-saved as CSV. Leading whitespace/control characters are ignored by some consumers, so skip them.
// eslint-disable-next-line no-control-regex
const FORMULA_PREFIX = /^[\s\u0000-\u001F]*[=+\-@]/
const SHEET_NAME_FORBIDDEN = /[[\]:*?/\\]/

/** Escapes a text value so a spreadsheet application never treats it as a formula. */
export function sanitizeXlsxText(value: string): string {
  const clean = value.replace(XML_INVALID_CHARS, '')
  // Tab / CR at the very start are also formula-injection vectors (OWASP CSV injection).
  if (clean.startsWith('\t') || clean.startsWith('\r') || FORMULA_PREFIX.test(clean)) {
    return `'${clean}`
  }
  return clean
}

function assertSheetName(name: string, label: string): void {
  const problem =
    name.length === 0 || name.length > XLSX_MAX_SHEET_NAME_CHARS
      ? `phải dài 1-${XLSX_MAX_SHEET_NAME_CHARS} ký tự`
      : SHEET_NAME_FORBIDDEN.test(name)
        ? 'không được chứa các ký tự [ ] : * ? / \\'
        : name.startsWith("'") || name.endsWith("'")
          ? 'không được bắt đầu hoặc kết thúc bằng dấu nháy đơn'
          : null
  if (problem) throw new XlsxExportError('invalid_sheet_name', `Tên ${label} ${problem}.`)
}

function checkedText(value: string, where: string): string {
  const clean = sanitizeXlsxText(value)
  if (clean.length > XLSX_MAX_CELL_CHARS) {
    throw new XlsxExportError(
      'invalid_value',
      `${where} vượt quá giới hạn ${XLSX_MAX_CELL_CHARS} ký tự của một ô Excel.`,
    )
  }
  return clean
}

function validateColumns(columns: readonly XlsxColumn[]): void {
  if (columns.length === 0) {
    throw new XlsxExportError('invalid_columns', 'Cần ít nhất một cột để xuất Excel.')
  }
  if (columns.length > XLSX_MAX_COLUMNS) {
    throw new XlsxExportError(
      'too_many_columns',
      `Bảng có ${columns.length} cột, vượt giới hạn ${XLSX_MAX_COLUMNS} cột của Excel.`,
    )
  }
  const keys = new Set<string>()
  const headers = new Set<string>()
  for (const column of columns) {
    if (column.key === '' || column.header.trim() === '') {
      throw new XlsxExportError('invalid_columns', 'Mỗi cột cần có mã cột và tiêu đề.')
    }
    if (keys.has(column.key)) {
      throw new XlsxExportError('invalid_columns', `Mã cột "${column.key}" bị trùng.`)
    }
    if (headers.has(column.header)) {
      throw new XlsxExportError(
        'invalid_columns',
        `Tiêu đề cột "${column.header}" bị trùng; các chỉ số khác nhau phải có tiêu đề khác nhau.`,
      )
    }
    keys.add(column.key)
    headers.add(column.header)
  }
}

function cellFor(
  column: XlsxColumn,
  row: Readonly<Record<string, XlsxCellValue>>,
  rowNumber: number,
): XlsxCellValue {
  const where = `Dòng ${rowNumber}, cột "${column.header}"`
  if (!Object.hasOwn(row, column.key) || row[column.key] === undefined) {
    throw new XlsxExportError('invalid_value', `${where}: thiếu giá trị (dùng null cho ô trống).`)
  }
  const value = row[column.key] as XlsxCellValue
  if (value === null) return null

  if (column.type === 'text') {
    if (typeof value !== 'string') {
      throw new XlsxExportError('invalid_value', `${where}: cần là văn bản.`)
    }
    return checkedText(value, where)
  }
  // vnd / integer: never a string, float, NaN, Infinity or an integer beyond 2^53-1.
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new XlsxExportError(
      'invalid_value',
      column.type === 'vnd'
        ? `${where}: số tiền phải là số nguyên VND an toàn, không có phần lẻ.`
        : `${where}: cần là số nguyên an toàn.`,
    )
  }
  return value
}

/** ASCII-only, filesystem-safe download name. Vietnamese diacritics are folded (đ → d). */
export function safeXlsxFilename(base: string): string {
  const folded = base.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  let stem = folded
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 80)
    .replace(/[-_]+$/g, '')
  if (stem === '') stem = 'bao-cao'
  // Reserved Windows device names stay reserved even with an extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = `${stem}-file`
  return `${stem}.xlsx`
}

export async function buildXlsxExport(input: XlsxExportInput): Promise<XlsxExportResult> {
  assertSheetName(input.sheetName, 'trang tính')
  if (input.sheetName === FILTER_SHEET_NAME) {
    throw new XlsxExportError(
      'invalid_sheet_name',
      `Tên trang tính "${FILTER_SHEET_NAME}" đã được dùng cho bộ lọc.`,
    )
  }
  validateColumns(input.columns)
  if (input.rows.length > XLSX_MAX_DATA_ROWS) {
    throw new XlsxExportError(
      'too_many_rows',
      `Có ${input.rows.length} dòng, vượt giới hạn ${XLSX_MAX_DATA_ROWS} dòng dữ liệu của Excel. Hãy thu hẹp bộ lọc.`,
    )
  }

  // Validate and convert everything before touching the workbook so a bad row fails the whole export.
  const headers = input.columns.map((c) => checkedText(c.header, `Tiêu đề cột "${c.header}"`))
  const body = input.rows.map((row, index) =>
    input.columns.map((column) => cellFor(column, row, index + 1)),
  )
  const filterRows = input.filters.map((f, index) => [
    checkedText(f.label, `Bộ lọc ${index + 1}, nhãn`),
    checkedText(f.value, `Bộ lọc ${index + 1}, giá trị`),
  ])
  const exportedAt =
    input.exportedAtLabel === undefined
      ? null
      : checkedText(input.exportedAtLabel, 'Thời điểm xuất')

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(input.sheetName)
  sheet.columns = input.columns.map((column, i) => ({
    key: column.key,
    width: column.width ?? Math.max(12, Math.min(40, (headers[i] ?? '').length + 2)),
    style: column.type === 'text' ? {} : { numFmt: '#,##0' },
  }))
  sheet.addRow(headers)
  for (const cells of body) sheet.addRow(cells)
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const filterSheet = workbook.addWorksheet(FILTER_SHEET_NAME)
  filterSheet.columns = [{ width: 28 }, { width: 60 }]
  filterSheet.addRow(['Bộ lọc', 'Giá trị'])
  filterSheet.getRow(1).font = { bold: true }
  for (const r of filterRows) filterSheet.addRow(r)
  filterSheet.addRow(['Số dòng dữ liệu', input.rows.length])
  if (exportedAt !== null) filterSheet.addRow(['Thời điểm xuất', exportedAt])

  const written = await workbook.xlsx.writeBuffer()
  return {
    buffer: new Uint8Array(written),
    filename: safeXlsxFilename(input.filenameBase),
    mimeType: XLSX_MIME_TYPE,
    rowCount: input.rows.length,
  }
}
