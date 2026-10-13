/** Keep the existing six-column validator and dry-run import contract authoritative. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_DATA_ROWS = 5000

export function openingStockSheetText(rows: readonly (readonly unknown[])[]): string {
  if (rows.length > MAX_IMPORT_DATA_ROWS + 1) {
    throw new Error('File có quá 5.000 dòng dữ liệu. Vui lòng chia thành các file nhỏ hơn.')
  }
  return rows
    .map((row, rowIndex) => {
      if (
        rowIndex === 0 &&
        String(row[0]).trim().toLowerCase() === 'kho' &&
        String(row[1]).trim().toUpperCase() === 'SKU'
      )
        row = ['Location Code', ...row.slice(1)]
      if (row.every((cell) => cell === null || cell === undefined || cell === '')) return ''
      if (row.slice(6).some((cell) => cell !== null && cell !== undefined && cell !== '')) {
        throw new Error('File phải có đúng 6 cột: Kho, SKU, Batch, NSX, HSD, SL.')
      }
      return Array.from({ length: 6 }, (_, index) => {
        const cell = row[index]
        let value: string
        if (cell === null || cell === undefined) value = ''
        else if (cell instanceof Date) {
          if ((index !== 3 && index !== 4) || !Number.isFinite(cell.getTime())) {
            throw new Error('Ô ngày không hợp lệ hoặc nằm ngoài cột NSX/HSD.')
          }
          value = cell.toISOString().slice(0, 10)
        } else if (typeof cell === 'string') value = cell
        else if (typeof cell === 'number' && Number.isFinite(cell)) value = String(cell)
        else throw new Error('File chứa ô dữ liệu không hỗ trợ. Vui lòng dùng chữ, số hoặc ngày.')
        if (/[\r\n]/.test(value)) throw new Error('Ô dữ liệu không được chứa xuống dòng.')
        return '"' + value.replace(/"/g, '""') + '"'
      }).join(',')
    })
    .join('\n')
}
