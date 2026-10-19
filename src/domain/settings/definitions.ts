/**
 * Known application settings (TECH_DESIGN §3.26 keys, PRD §29). Mirrors the validation done by the
 * database trigger `private.validate_app_setting()`: keep both in sync when adding a key.
 */
export type SettingValue = number | string | Record<string, unknown>

export interface SettingDefinition {
  key: string
  label: string
  description: string
  kind: 'integer' | 'enum' | 'text' | 'json'
  unit?: string
  min?: number
  max?: number
  options?: { value: string; label: string }[]
  /** For `text`: allowed shape. */
  pattern?: RegExp
  patternMessage?: string
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: 'reservation_ttl_hours',
    label: 'Thời gian giữ hàng tạm',
    description: 'Đơn chưa cọc/thanh toán sau thời gian này sẽ tự động giải phóng hàng.',
    kind: 'integer',
    unit: 'giờ',
    min: 1,
    max: 8760,
  },
  {
    key: 'allocation_lead_days',
    label: 'Số ngày khóa tồn trước ngày giao',
    description: 'Hệ thống khóa hàng thật cho đơn giao xa khi còn đúng số ngày này.',
    kind: 'integer',
    unit: 'ngày',
    min: 0,
    max: 365,
  },
  {
    key: 'default_deposit_type',
    label: 'Kiểu tiền cọc mặc định',
    description: 'Tính tiền cọc theo phần trăm đơn hàng hay theo số tiền cố định.',
    kind: 'enum',
    options: [
      { value: 'PERCENT', label: 'Phần trăm giá trị đơn' },
      { value: 'FIXED_AMOUNT', label: 'Số tiền cố định (₫)' },
    ],
  },
  {
    key: 'default_deposit_value',
    label: 'Giá trị tiền cọc mặc định',
    description: 'Phần trăm (nếu chọn kiểu phần trăm) hoặc số tiền ₫ (nếu chọn số tiền cố định).',
    kind: 'integer',
    min: 0,
    max: 100_000_000_000,
  },
  {
    key: 'batch_expiry_alert_days',
    label: 'Cảnh báo lô sắp hết hạn',
    description: 'Cảnh báo khi hạn sử dụng của lô còn ít hơn số ngày này.',
    kind: 'integer',
    unit: 'ngày',
    min: 0,
    max: 365,
  },
  {
    key: 'forecast_window_days',
    label: 'Cửa sổ dự báo',
    description: 'Số ngày tới được tính khi dự báo nhu cầu và kế hoạch sản xuất.',
    kind: 'integer',
    unit: 'ngày',
    min: 1,
    max: 365,
  },
  {
    key: 'order_prefix',
    label: 'Tiền tố mã đơn',
    description: 'Tiền tố của mã đơn và mã thanh toán, ví dụ TET → TET000123.',
    kind: 'text',
    pattern: /^[A-Z]{1,10}$/,
    patternMessage: 'Chỉ gồm 1–10 chữ cái in hoa không dấu, ví dụ TET.',
  },
  {
    key: 'sepay_config',
    label: 'Cấu hình mã QR thanh toán',
    description:
      'Thông tin công khai để tạo QR (JSON). Tuyệt đối không nhập khóa bí mật/HMAC/token ở đây.',
    kind: 'json',
  },
]

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((definition) => definition.key === key)
}

const SECRET_KEY_PATTERN = /"[^"]*(secret|hmac|token|password|api[_-]?key|private)[^"]*"\s*:/i

export type ParsedSetting = { value: SettingValue; error: null } | { value: null; error: string }

/** Parses what the Admin typed into the stored JSON value, or an error message. */
export function parseSettingInput(definition: SettingDefinition, raw: string): ParsedSetting {
  const text = raw.trim()
  if (text === '') return { value: null, error: 'Vui lòng nhập giá trị.' }

  switch (definition.kind) {
    case 'integer': {
      if (!/^\d{1,15}$/.test(text))
        return { value: null, error: 'Giá trị phải là số nguyên không âm.' }
      const value = Number(text)
      const min = definition.min ?? 0
      const max = definition.max ?? Number.MAX_SAFE_INTEGER
      if (value < min || value > max) {
        return {
          value: null,
          error: `Giá trị phải từ ${min.toLocaleString('vi-VN')} đến ${max.toLocaleString('vi-VN')}.`,
        }
      }
      return { value, error: null }
    }
    case 'enum': {
      if (!definition.options?.some((option) => option.value === text)) {
        return { value: null, error: 'Vui lòng chọn một giá trị trong danh sách.' }
      }
      return { value: text, error: null }
    }
    case 'text': {
      const value = text.toUpperCase()
      if (definition.pattern && !definition.pattern.test(value)) {
        return { value: null, error: definition.patternMessage ?? 'Giá trị không hợp lệ.' }
      }
      return { value, error: null }
    }
    case 'json': {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return { value: null, error: 'Nội dung phải là JSON hợp lệ.' }
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { value: null, error: 'Nội dung phải là một đối tượng JSON, ví dụ {"bank": "..."}.' }
      }
      if (SECRET_KEY_PATTERN.test(JSON.stringify(parsed))) {
        return {
          value: null,
          error:
            'Không được lưu khóa bí mật (secret, HMAC, token, mật khẩu) trong cấu hình. Hãy dùng biến môi trường phía máy chủ.',
        }
      }
      return { value: parsed as Record<string, unknown>, error: null }
    }
  }
}

/** Text shown in the list / prefilled in the form. */
export function formatSettingValue(definition: SettingDefinition, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (definition.kind === 'enum') {
    return definition.options?.find((option) => option.value === value)?.label ?? String(value)
  }
  if (definition.kind === 'json') return JSON.stringify(value)
  const text = typeof value === 'number' ? value.toLocaleString('vi-VN') : String(value)
  return definition.unit ? `${text} ${definition.unit}` : text
}

/** Raw text for editing (no thousands separators, no unit). */
export function settingToInputText(definition: SettingDefinition, value: unknown): string {
  if (value === null || value === undefined) return ''
  return definition.kind === 'json' ? JSON.stringify(value, null, 2) : String(value)
}
