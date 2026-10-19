import { describe, expect, it } from 'vitest'
import {
  SETTING_DEFINITIONS,
  formatSettingValue,
  getSettingDefinition,
  parseSettingInput,
} from '@/domain/settings/definitions'

const def = (key: string) => getSettingDefinition(key)!

describe('setting definitions', () => {
  it('cover exactly the keys suggested in TECH_DESIGN §3.26', () => {
    expect(SETTING_DEFINITIONS.map((d) => d.key).sort()).toEqual(
      [
        'allocation_lead_days',
        'batch_expiry_alert_days',
        'default_deposit_type',
        'default_deposit_value',
        'forecast_window_days',
        'order_prefix',
        'reservation_ttl_hours',
        'sepay_config',
      ].sort(),
    )
  })
})

describe('parseSettingInput', () => {
  it('parses bounded integers', () => {
    expect(parseSettingInput(def('reservation_ttl_hours'), '24')).toEqual({
      value: 24,
      error: null,
    })
    expect(parseSettingInput(def('allocation_lead_days'), '0').value).toBe(0)
  })

  it('rejects zero TTL, text, decimals and out-of-range numbers', () => {
    expect(parseSettingInput(def('reservation_ttl_hours'), '0').error).not.toBeNull()
    expect(parseSettingInput(def('reservation_ttl_hours'), '1.5').error).not.toBeNull()
    expect(parseSettingInput(def('reservation_ttl_hours'), 'abc').error).not.toBeNull()
    expect(parseSettingInput(def('reservation_ttl_hours'), '99999').error).not.toBeNull()
    expect(parseSettingInput(def('forecast_window_days'), '').error).not.toBeNull()
  })

  it('accepts only listed enum values', () => {
    expect(parseSettingInput(def('default_deposit_type'), 'PERCENT').value).toBe('PERCENT')
    expect(parseSettingInput(def('default_deposit_type'), 'HALF').error).not.toBeNull()
  })

  it('normalises and validates the order prefix', () => {
    expect(parseSettingInput(def('order_prefix'), ' tet ').value).toBe('TET')
    expect(parseSettingInput(def('order_prefix'), 'TẾT').error).not.toBeNull()
    expect(parseSettingInput(def('order_prefix'), 'TET1').error).not.toBeNull()
    expect(parseSettingInput(def('order_prefix'), 'ABCDEFGHIJK').error).not.toBeNull()
  })

  it('accepts a JSON object for sepay_config but refuses secrets and non-objects', () => {
    expect(parseSettingInput(def('sepay_config'), '{"bank":"MB","account":"123"}').value).toEqual({
      bank: 'MB',
      account: '123',
    })
    expect(parseSettingInput(def('sepay_config'), '[1]').error).not.toBeNull()
    expect(parseSettingInput(def('sepay_config'), 'not json').error).not.toBeNull()
    for (const secret of [
      '{"hmac_secret":"x"}',
      '{"a":{"apiKey":"x"}}',
      '{"Webhook_Token":"x"}',
      '{"password":"x"}',
    ]) {
      expect(parseSettingInput(def('sepay_config'), secret).error).toMatch(/bí mật/)
    }
  })
})

describe('formatSettingValue', () => {
  it('shows units, enum labels and compact JSON', () => {
    expect(formatSettingValue(def('reservation_ttl_hours'), 24)).toBe('24 giờ')
    expect(formatSettingValue(def('default_deposit_type'), 'PERCENT')).toMatch(/Phần trăm/)
    expect(formatSettingValue(def('sepay_config'), { a: 1 })).toBe('{"a":1}')
    expect(formatSettingValue(def('order_prefix'), undefined)).toBe('')
  })
})
