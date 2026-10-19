import { describe, expect, it } from 'vitest'
import {
  coverageText,
  holdRemainingText,
  shortageMessage,
  type StockLine,
} from '@/domain/inventory/shortage'

const line = (over: Partial<StockLine> = {}): StockLine => ({
  product_id: 'p',
  quantity: 50,
  sellable_now: 20,
  shortage: 30,
  suggestions: [],
  ...over,
})

describe('shortageMessage (RES-009 / RES-010)', () => {
  it('is null when nothing is missing', () => {
    expect(shortageMessage(line({ shortage: 0 }))).toBeNull()
  })

  it('names the shortage and the best source, like the AGENTS example', () => {
    const message = shortageMessage(
      line({
        suggestions: [
          {
            location_id: 'l',
            code: 'HN-VP',
            name: 'VP Minh Khai',
            sellable_qty: 80,
            same_region: true,
            covers_all: true,
          },
        ],
      }),
    )
    expect(message).toBe(
      'Kho này không đủ hàng có thể bán: thiếu 30 cái. Đề xuất chuyển 30 từ VP Minh Khai (cùng khu vực).',
    )
  })

  it('says so when the best source cannot cover everything', () => {
    const message = shortageMessage(
      line({
        suggestions: [
          {
            location_id: 'l',
            code: 'HCM',
            name: 'Kho HCM',
            sellable_qty: 12,
            same_region: false,
            covers_all: false,
          },
        ],
      }),
    )
    expect(message).toMatch(/Kho HCM chỉ chuyển được 12/)
    expect(message).not.toMatch(/cùng khu vực/)
  })

  it('points to production planning when no location can help', () => {
    expect(shortageMessage(line())).toMatch(/Chưa có kho nào khác đủ hàng.*sản xuất/)
  })
})

describe('holdRemainingText', () => {
  const now = new Date('2026-10-02T10:00:00Z')

  it('shows hours and minutes left', () => {
    expect(holdRemainingText('2026-10-02T15:20:00Z', now)).toBe('còn 5 giờ 20 phút')
    expect(holdRemainingText('2026-10-02T10:45:00Z', now)).toBe('còn 45 phút')
  })

  it('switches to days when long, and reports expiry', () => {
    expect(holdRemainingText('2026-10-04T13:00:00Z', now)).toBe('còn 2 ngày 3 giờ')
    expect(holdRemainingText('2026-10-02T09:59:00Z', now)).toBe('Đã hết thời gian giữ hàng')
    expect(holdRemainingText('2026-10-02T10:00:00Z', now)).toBe('Đã hết thời gian giữ hàng')
    expect(holdRemainingText('not a date', now)).toBe('')
  })
})

describe('coverageText', () => {
  it('describes what is set aside', () => {
    expect(coverageText(line({ quantity: 10, allocated: 10 }))).toBe('Đã phân bổ đủ hàng')
    expect(coverageText(line({ quantity: 10, allocated: 4 }))).toBe('Đã phân bổ 4/10')
    expect(coverageText(line({ quantity: 10, temp_reserved: 10 }))).toBe(
      'Đang giữ hàng tạm đủ số lượng',
    )
    expect(coverageText(line({ quantity: 10, temp_reserved: 3 }))).toBe('Đang giữ tạm 3/10')
    expect(coverageText(line({ quantity: 10 }))).toBe('Chưa giữ hàng')
  })
})
