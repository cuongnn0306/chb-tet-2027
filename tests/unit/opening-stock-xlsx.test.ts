import { Blob as NodeBlob } from 'node:buffer'
import { expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import readExcelFile from 'read-excel-file/node'
import { openingStockSheetText } from '@/domain/inventory/opening-stock-xlsx'
import { parseOpeningStockText } from '@/domain/inventory/opening-stock-import'

it('preserves quoted codes, UTC dates and physical blank-row numbering through existing validation', () => {
  const text = openingStockSheetText([
    ['Kho', 'SKU', 'Batch', 'NSX', 'HSD', 'SL'],
    [],
    [
      'HN,BE P',
      'TT-1200',
      'B"01',
      new Date('2027-01-01T00:00:00Z'),
      new Date('2027-03-01T00:00:00Z'),
      100,
    ],
  ])
  const parsed = parseOpeningStockText(text)
  expect(parsed.issues).toEqual([])
  expect(parsed.lines).toEqual([3])
  expect(parsed.rows[0]).toMatchObject({
    location_code: 'HN,BE P',
    batch_code: 'B"01',
    manufactured_date: '2027-01-01',
    quantity: 100,
  })
})
it('rejects excess columns, booleans, multiline cells and oversized sheets', () => {
  expect(() => openingStockSheetText([[1, 2, 3, 4, 5, 6, 7]])).toThrow('6 cột')
  expect(() => openingStockSheetText([[true]])).toThrow('không hỗ trợ')
  expect(() => openingStockSheetText([['a\nb']])).toThrow('xuống dòng')
  expect(() => openingStockSheetText(Array.from({ length: 5002 }, () => []))).toThrow('5.000')
})
it('decodes a real zipped xlsx sheet into the existing import validator', async () => {
  const cells = ['HN-BEP', 'TT-1200', 'B01', '01/01/2027', '01/03/2027', '100']
  // read-excel-file/node is typed against Node's Blob; the DOM Blob of this project's lib is not assignable to it.
  const workbook = new NodeBlob([
    zipSync({
      'xl/workbook.xml': strToU8(
        '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ton" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData><row r="1">' +
          cells
            .map(
              (v, i) =>
                '<c r="' +
                String.fromCharCode(65 + i) +
                '1" t="inlineStr"><is><t>' +
                v +
                '</t></is></c>',
            )
            .join('') +
          '</row></sheetData></worksheet>',
      ),
    }).buffer as ArrayBuffer,
  ])
  const sheets = await readExcelFile(workbook)
  expect(sheets).toHaveLength(1)
  const parsed = parseOpeningStockText(openingStockSheetText(sheets[0]!.data))
  expect(parsed.issues).toEqual([])
  expect(parsed.rows[0]?.quantity).toBe(100)
})
