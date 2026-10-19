// @ts-expect-error TS7016: typings not resolvable through package.json "exports"
import ExcelJSModule from '@excel.js/exceljs'
import { describe, expect, it } from 'vitest'
import {
  FILTER_SHEET_NAME,
  XLSX_MAX_DATA_ROWS,
  XlsxExportError,
  buildXlsxExport,
  safeXlsxFilename,
  sanitizeXlsxText,
  type XlsxColumn,
  type XlsxExportInput,
} from '@/lib/report-xlsx-export'

const columns: XlsxColumn[] = [
  { key: 'code', header: 'Mã đơn', type: 'text' },
  { key: 'gross', header: 'Doanh số gộp (Gross Sales)', type: 'vnd' },
  { key: 'cash', header: 'Tiền đã thu (Cash Collected)', type: 'vnd' },
  { key: 'units', header: 'Số bánh', type: 'integer' },
]

function input(overrides: Partial<XlsxExportInput> = {}): XlsxExportInput {
  return {
    sheetName: 'Đơn hàng',
    filenameBase: 'Đơn hàng Tết 2027',
    columns,
    rows: [
      { code: 'TET-1001', gross: 1_200_000, cash: 500_000, units: 10 },
      { code: 'TET-1002', gross: 900_000, cash: 900_000, units: 7 },
    ],
    filters: [
      { label: 'Từ ngày', value: '01/01/2027' },
      { label: 'Kênh', value: 'Cửa hàng' },
    ],
    ...overrides,
  }
}

// Minimal reader-side typing for the workbook we reopen.
interface CellLike {
  value: unknown
  type: unknown
}
interface Worksheet {
  name: string
  rowCount: number
  getRow(index: number): { values: unknown; getCell(column: number): CellLike }
}
interface ReopenedWorkbook {
  worksheets: Worksheet[]
  getWorksheet(name: string): Worksheet | undefined
}
const ExcelJS = ExcelJSModule as {
  Workbook: new () => { xlsx: { load(data: Uint8Array): Promise<unknown> } } & ReopenedWorkbook
  ValueType: { Formula: unknown }
}

async function reopen(buffer: Uint8Array): Promise<ReopenedWorkbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  return workbook
}

function rowValues(sheet: Worksheet, rowNumber: number): unknown[] {
  const values = sheet.getRow(rowNumber).values as unknown[]
  return values.slice(1)
}

async function expectExportError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(XlsxExportError)
  expect((error as XlsxExportError).code).toBe(code)
  return error as XlsxExportError
}

describe('buildXlsxExport', () => {
  it('writes a valid xlsx with Vietnamese headers and exactly the supplied rows', async () => {
    const result = await buildXlsxExport(input())

    // xlsx is a zip package.
    expect(Array.from(result.buffer.slice(0, 2))).toEqual([0x50, 0x4b])
    expect(result.rowCount).toBe(2)
    expect(result.mimeType).toContain('spreadsheetml.sheet')
    expect(result.filename).toBe('Don-hang-Tet-2027.xlsx')

    const workbook = await reopen(result.buffer)
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Đơn hàng', FILTER_SHEET_NAME])
    const sheet = workbook.getWorksheet('Đơn hàng')!
    expect(sheet.rowCount).toBe(3)
    expect(rowValues(sheet, 1)).toEqual([
      'Mã đơn',
      'Doanh số gộp (Gross Sales)',
      'Tiền đã thu (Cash Collected)',
      'Số bánh',
    ])
    expect(rowValues(sheet, 2)).toEqual(['TET-1001', 1_200_000, 500_000, 10])
    expect(rowValues(sheet, 3)).toEqual(['TET-1002', 900_000, 900_000, 7])
  })

  it('keeps Gross Sales and Cash Collected as separate columns and never swaps them', async () => {
    const { buffer } = await buildXlsxExport(
      input({ rows: [{ code: 'TET-2001', gross: 2_000_000, cash: 0, units: 20 }] }),
    )
    const sheet = (await reopen(buffer)).getWorksheet('Đơn hàng')!
    const header = rowValues(sheet, 1)
    const data = rowValues(sheet, 2)
    expect(data[header.indexOf('Doanh số gộp (Gross Sales)')]).toBe(2_000_000)
    // Nothing collected yet: cash is a real 0, not the gross value and not blank.
    expect(data[header.indexOf('Tiền đã thu (Cash Collected)')]).toBe(0)
  })

  it('rejects columns that would merge two measures under the same header or key', async () => {
    await expectExportError(
      buildXlsxExport(
        input({
          columns: [
            { key: 'gross', header: 'Doanh thu', type: 'vnd' },
            { key: 'cash', header: 'Doanh thu', type: 'vnd' },
          ],
          rows: [],
        }),
      ),
      'invalid_columns',
    )
    await expectExportError(
      buildXlsxExport(
        input({
          columns: [
            { key: 'gross', header: 'A', type: 'vnd' },
            { key: 'gross', header: 'B', type: 'vnd' },
          ],
          rows: [],
        }),
      ),
      'invalid_columns',
    )
    await expectExportError(buildXlsxExport(input({ columns: [], rows: [] })), 'invalid_columns')
  })

  it('keeps integer VND as an integer number cell (no float, no string)', async () => {
    const big = Number.MAX_SAFE_INTEGER
    const { buffer } = await buildXlsxExport(
      input({ rows: [{ code: 'X', gross: big, cash: -250_000, units: 0 }] }),
    )
    const sheet = (await reopen(buffer)).getWorksheet('Đơn hàng')!
    const cell = sheet.getRow(2).getCell(2)
    expect(typeof cell.value).toBe('number')
    expect(cell.value).toBe(big)
    expect(sheet.getRow(2).getCell(3).value).toBe(-250_000) // returns/adjustments may be negative
  })

  it('rejects unsafe numeric values and wrong types, naming row and column', async () => {
    const bad: unknown[] = [12.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '1200000']
    for (const gross of bad) {
      const error = await expectExportError(
        buildXlsxExport(
          input({
            rows: [
              { code: 'ok', gross: 1, cash: 1, units: 1 },
              { code: 'bad', gross: gross as number, cash: 1, units: 1 },
            ],
          }),
        ),
        'invalid_value',
      )
      expect(error.message).toContain('Dòng 2')
      expect(error.message).toContain('Doanh số gộp (Gross Sales)')
    }
    await expectExportError(
      buildXlsxExport(input({ rows: [{ code: 'x', gross: 1, cash: 1, units: 1.5 }] })),
      'invalid_value',
    )
    await expectExportError(
      buildXlsxExport(
        input({ rows: [{ code: 5 as unknown as string, gross: 1, cash: 1, units: 1 }] }),
      ),
      'invalid_value',
    )
  })

  it('requires every column key per row; null becomes an empty cell', async () => {
    await expectExportError(
      buildXlsxExport(input({ rows: [{ code: 'x', gross: 1, cash: 1 } as never] })),
      'invalid_value',
    )
    const { buffer } = await buildXlsxExport(
      input({ rows: [{ code: null, gross: null, cash: 5, units: null }] }),
    )
    const row = (await reopen(buffer)).getWorksheet('Đơn hàng')!.getRow(2)
    expect(row.getCell(1).value).toBeNull()
    expect(row.getCell(2).value).toBeNull()
    expect(row.getCell(3).value).toBe(5)
  })

  it('neutralizes formula injection in text cells, headers and filter snapshot', async () => {
    const payloads = ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1', '\r=1', ' =HYPERLINK("x")']
    const { buffer } = await buildXlsxExport(
      input({
        columns: [
          { key: 'a', header: '=EVIL()', type: 'text' },
          { key: 'b', header: 'Ghi chú', type: 'text' },
        ],
        rows: payloads.map((p) => ({ a: p, b: 'bình thường' })),
        filters: [{ label: '@label', value: '=1+1' }],
      }),
    )
    const workbook = await reopen(buffer)
    const sheet = workbook.getWorksheet('Đơn hàng')!
    expect(sheet.getRow(1).getCell(1).value).toBe("'=EVIL()")
    payloads.forEach((p, i) => {
      const cell = sheet.getRow(i + 2).getCell(1)
      expect(cell.type).not.toBe(ExcelJS.ValueType.Formula)
      // XML line-end normalization turns a stored CR into LF when the workbook is read back.
      expect(cell.value).toBe(`'${p.replace(/\r/g, '\n')}`)
    })
    expect(sheet.getRow(2).getCell(2).value).toBe('bình thường')
    const filters = workbook.getWorksheet(FILTER_SHEET_NAME)!
    expect(rowValues(filters, 2)).toEqual(["'@label", "'=1+1"])
  })

  it('does not prefix harmless text and escapes XML-significant characters losslessly', async () => {
    const text = 'A & B <tag> "quote" Ớ ế ñ 100% - ok'
    const { buffer } = await buildXlsxExport(
      input({
        columns: [{ key: 'a', header: 'Ghi chú', type: 'text' }],
        rows: [{ a: text }, { a: 'a-b' }, { a: '' }],
      }),
    )
    const sheet = (await reopen(buffer)).getWorksheet('Đơn hàng')!
    expect(sheet.getRow(2).getCell(1).value).toBe(text)
    expect(sheet.getRow(3).getCell(1).value).toBe('a-b')
  })

  it('removes control characters XML cannot carry instead of corrupting the file', async () => {
    expect(sanitizeXlsxText('a\u0000b\u0008c\u001Fd')).toBe('abcd')
    const { buffer } = await buildXlsxExport(
      input({
        columns: [{ key: 'a', header: 'Ghi chú', type: 'text' }],
        rows: [{ a: 'x\u0000y\u0007z' }],
      }),
    )
    const sheet = (await reopen(buffer)).getWorksheet('Đơn hàng')!
    expect(sheet.getRow(2).getCell(1).value).toBe('xyz')
  })

  it('records the filter snapshot, row count and optional export label on its own sheet', async () => {
    const { buffer } = await buildXlsxExport(input({ exportedAtLabel: '06/10/2026 12:00' }))
    const filters = (await reopen(buffer)).getWorksheet(FILTER_SHEET_NAME)!
    expect(rowValues(filters, 1)).toEqual(['Bộ lọc', 'Giá trị'])
    expect(rowValues(filters, 2)).toEqual(['Từ ngày', '01/01/2027'])
    expect(rowValues(filters, 3)).toEqual(['Kênh', 'Cửa hàng'])
    expect(rowValues(filters, 4)).toEqual(['Số dòng dữ liệu', 2])
    expect(rowValues(filters, 5)).toEqual(['Thời điểm xuất', '06/10/2026 12:00'])
  })

  it('exports an empty result as a header-only workbook that still shows the filters', async () => {
    const result = await buildXlsxExport(input({ rows: [] }))
    expect(result.rowCount).toBe(0)
    const workbook = await reopen(result.buffer)
    const sheet = workbook.getWorksheet('Đơn hàng')!
    expect(sheet.rowCount).toBe(1)
    expect(rowValues(sheet, 1)[0]).toBe('Mã đơn')
    const filters = workbook.getWorksheet(FILTER_SHEET_NAME)!
    expect(rowValues(filters, 4)).toEqual(['Số dòng dữ liệu', 0])
  })

  it('does not select, reorder or drop the rows it is given', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      code: `R${i}`,
      gross: i * 1000,
      cash: i * 100,
      units: i,
    }))
    const { buffer } = await buildXlsxExport(input({ rows: rows.slice().reverse() }))
    const sheet = (await reopen(buffer)).getWorksheet('Đơn hàng')!
    expect(sheet.rowCount).toBe(51)
    expect(sheet.getRow(2).getCell(1).value).toBe('R49')
    expect(sheet.getRow(51).getCell(1).value).toBe('R0')
  })

  it('enforces spreadsheet row, column, sheet-name and cell limits', async () => {
    await expectExportError(
      buildXlsxExport(input({ rows: new Array(XLSX_MAX_DATA_ROWS + 1).fill({}) })),
      'too_many_rows',
    )
    const many = Array.from({ length: 16_385 }, (_, i) => ({
      key: `k${i}`,
      header: `H${i}`,
      type: 'text' as const,
    }))
    await expectExportError(buildXlsxExport(input({ columns: many, rows: [] })), 'too_many_columns')

    for (const sheetName of [
      '',
      'x'.repeat(32),
      'a/b',
      'a:b',
      '[a]',
      "'a",
      'a?',
      FILTER_SHEET_NAME,
    ]) {
      await expectExportError(buildXlsxExport(input({ sheetName })), 'invalid_sheet_name')
    }
    await expectExportError(
      buildXlsxExport(
        input({
          columns: [{ key: 'a', header: 'Ghi chú', type: 'text' }],
          rows: [{ a: 'x'.repeat(32_768) }],
        }),
      ),
      'invalid_value',
    )
  })
})

describe('safeXlsxFilename', () => {
  it('folds Vietnamese diacritics and strips path/unsafe characters', () => {
    expect(safeXlsxFilename('Báo cáo Đơn hàng Tết')).toBe('Bao-cao-Don-hang-Tet.xlsx')
    expect(safeXlsxFilename('../../etc/passwd')).toBe('etc-passwd.xlsx')
    expect(safeXlsxFilename('a\\b:c*d?"e<f>g|h')).toBe('a-b-c-d-e-f-g-h.xlsx')
    expect(safeXlsxFilename('report.xlsx.exe')).toBe('report-xlsx-exe.xlsx')
  })

  it('falls back, avoids reserved device names and bounds the length', () => {
    expect(safeXlsxFilename('')).toBe('bao-cao.xlsx')
    expect(safeXlsxFilename('***')).toBe('bao-cao.xlsx')
    expect(safeXlsxFilename('CON')).toBe('CON-file.xlsx')
    expect(safeXlsxFilename('a'.repeat(300)).length).toBe(80 + '.xlsx'.length)
  })
})
