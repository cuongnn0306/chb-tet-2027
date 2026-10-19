import { describe, expect, it } from 'vitest'
import {
  REVIEW_TEXT_FALLBACK,
  readPaymentReviewPayload,
  readTransferAmount,
} from '@/domain/payments/review-payload'

describe('readTransferAmount (server rule: positive integer VND)', () => {
  it('accepts a positive integer', () => {
    expect(readTransferAmount(500000)).toBe(500000)
    expect(readTransferAmount(1)).toBe(1)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['object', { amount: 1 }],
    ['array', [500000]],
    ['numeric string', '500000'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['fractional', 1000.5],
    ['zero', 0],
    ['negative', -500000],
    ['over 13 digits', 10_000_000_000_000],
    ['unsafe integer', 2 ** 60],
    ['boolean', true],
  ])('rejects %s', (_label, value) => {
    expect(readTransferAmount(value)).toBeNull()
  })
})

describe('readPaymentReviewPayload', () => {
  it('reads a valid payload', () => {
    expect(
      readPaymentReviewPayload(
        { transferAmount: 750000, gateway: 'MBBank', content: ' TET000123 ', description: 'x' },
        'sepay',
      ),
    ).toEqual({ amount: 750000, gateway: 'MBBank', content: 'TET000123' })
  })

  it('falls back to the provider, then description, then a dash', () => {
    expect(readPaymentReviewPayload({ transferAmount: 1, description: 'desc' }, 'sepay')).toEqual({
      amount: 1,
      gateway: 'sepay',
      content: 'desc',
    })
    expect(readPaymentReviewPayload({ content: '  ', description: '' }, 'sepay')).toEqual({
      amount: null,
      gateway: 'sepay',
      content: REVIEW_TEXT_FALLBACK,
    })
  })

  it('never lets object/array/number text fields through', () => {
    const view = readPaymentReviewPayload(
      { gateway: { a: 1 }, content: ['x'], description: 42, transferAmount: [1] },
      'sepay',
    )
    expect(view).toEqual({ amount: null, gateway: 'sepay', content: REVIEW_TEXT_FALLBACK })
  })

  it.each([null, undefined, 'text', 42, [], [{ transferAmount: 5 }]])(
    'treats a non-object payload (%j) as empty',
    (payload) => {
      expect(readPaymentReviewPayload(payload, 'sepay')).toEqual({
        amount: null,
        gateway: 'sepay',
        content: REVIEW_TEXT_FALLBACK,
      })
    },
  )

  it('keeps markup as plain text (escaping is left to JSX text rendering)', () => {
    expect(readPaymentReviewPayload({ content: '<img src=x onerror=alert(1)>' }, 'p').content).toBe(
      '<img src=x onerror=alert(1)>',
    )
  })
})
