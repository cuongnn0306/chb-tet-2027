/** Presentation rules for the stock situation of an order (RES-009 / RES-010). Pure and tested. */
export interface SourceSuggestion {
  location_id: string
  code: string
  name: string
  sellable_qty: number
  same_region: boolean
  covers_all: boolean
}

export interface StockLine {
  product_id: string
  quantity: number
  /** Units held by an ACTIVE reservation (temporary or physical). */
  covered?: number
  temp_reserved?: number
  allocated?: number
  sellable_now: number
  shortage: number
  suggestions: SourceSuggestion[]
  sku?: string
  name?: string
  order_item_id?: string
}

/**
 * The actionable message of AGENTS §8: say what is missing and what to do about it, e.g.
 * "Kho này không đủ hàng có thể bán: thiếu 30 cái. Đề xuất chuyển 30 từ VP Minh Khai (cùng khu vực)."
 * Returns null when nothing is missing.
 */
export function shortageMessage(line: StockLine): string | null {
  if (line.shortage <= 0) return null
  const base = `Kho này không đủ hàng có thể bán: thiếu ${line.shortage.toLocaleString('vi-VN')} cái.`
  const best = line.suggestions[0]
  if (!best)
    return `${base} Chưa có kho nào khác đủ hàng để chuyển; hãy báo Kho/Admin để lên kế hoạch sản xuất.`

  const take = Math.min(best.sellable_qty, line.shortage)
  const where = `${best.name}${best.same_region ? ' (cùng khu vực)' : ''}`
  if (best.covers_all) return `${base} Đề xuất chuyển ${take.toLocaleString('vi-VN')} từ ${where}.`
  return `${base} ${where} chỉ chuyển được ${take.toLocaleString('vi-VN')}; cần lấy thêm từ kho khác hoặc chờ sản xuất.`
}

/** "Giữ hàng đến 03/10/2026 14:30 (còn 5 giờ 20 phút)" or "Đã hết thời gian giữ hàng". */
export function holdRemainingText(expiresAt: string, now: Date = new Date()): string {
  const end = new Date(expiresAt).getTime()
  if (Number.isNaN(end)) return ''
  const minutes = Math.floor((end - now.getTime()) / 60_000)
  if (minutes <= 0) return 'Đã hết thời gian giữ hàng'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours >= 24) return `còn ${Math.floor(hours / 24)} ngày ${hours % 24} giờ`
  if (hours > 0) return `còn ${hours} giờ ${rest} phút`
  return `còn ${rest} phút`
}

/** What has been set aside for a line, in words a salesperson understands. */
export function coverageText(line: StockLine): string {
  const allocated = line.allocated ?? 0
  const held = line.temp_reserved ?? 0
  if (allocated >= line.quantity) return 'Đã phân bổ đủ hàng'
  if (allocated > 0) return `Đã phân bổ ${allocated}/${line.quantity}`
  if (held >= line.quantity) return 'Đang giữ hàng tạm đủ số lượng'
  if (held > 0) return `Đang giữ tạm ${held}/${line.quantity}`
  return 'Chưa giữ hàng'
}
