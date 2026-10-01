import { describe, expect, it } from 'vitest'
import {
  IMPORT_TEMPLATE,
  parseImportDate,
  parseImportQuantity,
  parseOpeningStockText,
  splitLine,
} from '@/domain/inventory/opening-stock-import'

describe('parseImportDate', () => {
  it('accepts Vietnamese and ISO dates, normalising to yyyy-MM-dd', () => {
    expect(parseImportDate('06/02/2027')).toBe('2027-02-06')
    expect(parseImportDate('6/2/2027')).toBe('2027-02-06')
    expect(parseImportDate('06-02-2027')).toBe('2027-02-06')
    expect(parseImportDate('06.02.2027')).toBe('2027-02-06')
    expect(parseImportDate('2027-02-06')).toBe('2027-02-06')
  })

  it('rejects impossible and malformed dates', () => {
    for (const bad of [
      '30/02/2027',
      '31/04/2027',
      '2027/02/06',
      '06/02/27',
      '',
      'abc',
      '13/13/2027',
    ]) {
      expect(parseImportDate(bad), bad).toBeNull()
    }
  })
})

describe('parseImportQuantity', () => {
  it('parses whole numbers with optional thousands separators', () => {
    expect(parseImportQuantity('120')).toBe(120)
    expect(parseImportQuantity('1.200')).toBe(1200)
    expect(parseImportQuantity('1,200')).toBe(1200)
    expect(parseImportQuantity(' 1 200 ')).toBe(1200)
  })

  it('rejects fractions, negatives and text', () => {
    for (const bad of ['1.5', '-3', 'abc', '', '12,5'])
      expect(parseImportQuantity(bad), bad).toBeNull()
  })
})

describe('splitLine', () => {
  it('splits on the delimiter and keeps quoted cells together', () => {
    expect(splitLine('a,b,c', ',')).toEqual(['a', 'b', 'c'])
    expect(splitLine('a,"b, c",d', ',')).toEqual(['a', 'b, c', 'd'])
    expect(splitLine('a,"say ""hi""",d', ',')).toEqual(['a', 'say "hi"', 'd'])
    expect(splitLine('a\tb\tc', '\t')).toEqual(['a', 'b', 'c'])
  })
})

describe('parseOpeningStockText', () => {
  it('parses the template as exported to CSV', () => {
    const parsed = parseOpeningStockText(IMPORT_TEMPLATE)
    expect(parsed.issues).toEqual([])
    expect(parsed.rows).toEqual([
      {
        location_code: 'HN-BEP',
        sku: 'TT-1200',
        batch_code: 'B-2027-01',
        manufactured_date: '2027-01-01',
        expiry_date: '2027-03-01',
        quantity: 100,
      },
    ])
    expect(parsed.lines).toEqual([2])
  })

  it('parses text pasted straight from Excel (tab-separated), with or without a header', () => {
    const withHeader =
      'Location Code\tSKU\tBatch\tNSX\tHSD\tQty\nhn-bep\ttt-800\tb1\t01/01/2027\t01/03/2027\t50\nHN-CH1\tTT-800\tb1\t01/01/2027\t01/03/2027\t20'
    const parsed = parseOpeningStockText(withHeader)
    expect(parsed.issues).toEqual([])
    expect(parsed.rows.map((r) => [r.location_code, r.sku, r.batch_code, r.quantity])).toEqual([
      ['HN-BEP', 'TT-800', 'B1', 50],
      ['HN-CH1', 'TT-800', 'B1', 20],
    ])
    expect(
      parseOpeningStockText('HN-BEP\tTT-800\tB1\t01/01/2027\t01/03/2027\t50').rows,
    ).toHaveLength(1)
  })

  it('supports semicolon-separated files, BOM, blank lines and CRLF', () => {
    const text =
      '\uFEFFLocation Code;SKU;Batch;NSX;HSD;Qty\r\n\r\nHN-BEP;TT-800;B1;01/01/2027;01/03/2027;5\r\n'
    const parsed = parseOpeningStockText(text)
    expect(parsed.issues).toEqual([])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.lines).toEqual([3])
  })

  it('reports every bad line with its line number and the reasons', () => {
    const text = [
      'Location Code,SKU,Batch,NSX,HSD,Qty',
      'HN-BEP,TT-800,B1,01/01/2027,01/03/2027,5',
      'HN-BEP,TT-800,B2,31/02/2027,01/03/2027,5',
      ',,B3,01/01/2027,01/03/2027,0',
      'HN-BEP,TT-800',
    ].join('\n')
    const parsed = parseOpeningStockText(text)
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.issues.map((i) => i.line)).toEqual([3, 4, 5])
    expect(parsed.issues[0]?.message).toMatch(/ngày sản xuất/)
    expect(parsed.issues[1]?.message).toMatch(/thiếu mã địa điểm.*thiếu SKU.*số lượng/)
    expect(parsed.issues[2]?.message).toMatch(/6 cột/)
  })

  it('explains an empty paste or a header-only paste', () => {
    expect(parseOpeningStockText('').issues[0]?.message).toMatch(/Chưa có dữ liệu/)
    expect(parseOpeningStockText('   \n  ').issues).toHaveLength(1)
    expect(parseOpeningStockText('Location Code,SKU,Batch,NSX,HSD,Qty').issues[0]?.message).toMatch(
      /Không có dòng dữ liệu/,
    )
  })
})
