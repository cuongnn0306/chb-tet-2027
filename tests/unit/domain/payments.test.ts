import { describe, expect, it } from 'vitest'
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  buildSepayQrUrl,
  computeDeposit,
  isPaymentStatus,
  orderPaymentState,
  validateRecordPayment,
} from '@/domain/payments/payments'

describe('vocabulary', () => {
  it('has Vietnamese labels for every method and status', () => {
    for (const method of PAYMENT_METHODS) expect(PAYMENT_METHOD_LABELS[method]).toBeTruthy()
    for (const status of PAYMENT_STATUSES) expect(PAYMENT_STATUS_LABELS[status]).toBeTruthy()
    expect(isPaymentStatus('CONFIRMED')).toBe(true)
    expect(isPaymentStatus('confirmed')).toBe(false)
  })
})

describe('orderPaymentState (PRD §18)', () => {
  const order = { net_amount: 500000, paid_amount: 0, deposit_required: 150000 }

  it('is unpaid with no money', () => {
    expect(orderPaymentState(order)).toBe('UNPAID')
  })

  it('is partial below the deposit, deposited at or above it, paid in full at the net amount', () => {
    expect(orderPaymentState({ ...order, paid_amount: 100000 })).toBe('PARTIAL')
    expect(orderPaymentState({ ...order, paid_amount: 150000 })).toBe('DEPOSITED')
    expect(orderPaymentState({ ...order, paid_amount: 499999 })).toBe('DEPOSITED')
    expect(orderPaymentState({ ...order, paid_amount: 500000 })).toBe('PAID')
  })

  it('treats any payment as partial when no deposit is required', () => {
    expect(orderPaymentState({ net_amount: 500000, paid_amount: 1, deposit_required: 0 })).toBe(
      'PARTIAL',
    )
  })
})

describe('computeDeposit (mirrors the database rule)', () => {
  it('rounds a percentage UP to whole VND', () => {
    expect(computeDeposit(33333, 'PERCENT', 30)).toBe(10000) // 9.999,9
    expect(computeDeposit(500000, 'PERCENT', 30)).toBe(150000)
    expect(computeDeposit(100001, 'PERCENT', 50)).toBe(50001)
  })

  it('takes a fixed amount but never more than the order', () => {
    expect(computeDeposit(500000, 'FIXED_AMOUNT', 200000)).toBe(200000)
    expect(computeDeposit(50000, 'FIXED_AMOUNT', 200000)).toBe(50000)
  })

  it('handles 0% and over-100% values safely', () => {
    expect(computeDeposit(500000, 'PERCENT', 0)).toBe(0)
    expect(computeDeposit(500000, 'PERCENT', 250)).toBe(500000)
  })
})

describe('buildSepayQrUrl (PAY-005)', () => {
  it('carries account, bank, exact amount and the payment code', () => {
    const url = new URL(
      buildSepayQrUrl({
        bank: 'MBBank',
        accountNo: '0123456789',
        amount: 150000,
        content: 'TET000123',
      }),
    )
    expect(url.origin + url.pathname).toBe('https://qr.sepay.vn/img')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      acc: '0123456789',
      bank: 'MBBank',
      amount: '150000',
      des: 'TET000123',
    })
  })

  it('encodes special characters and never emits a negative or fractional amount', () => {
    const url = buildSepayQrUrl({ bank: 'A B', accountNo: '1', amount: 99.9, content: 'TET 1&x=y' })
    expect(url).toContain('bank=A+B')
    expect(new URL(url).searchParams.get('des')).toBe('TET 1&x=y')
    expect(new URL(url).searchParams.get('amount')).toBe('99')
    expect(
      new URL(
        buildSepayQrUrl({ bank: 'b', accountNo: '1', amount: -5, content: 'x' }),
      ).searchParams.get('amount'),
    ).toBe('0')
  })
})

describe('validateRecordPayment', () => {
  it('accepts a method and a whole-VND amount within the remaining balance', () => {
    expect(
      validateRecordPayment({
        method: 'CASH',
        amount: '150.000',
        received: true,
        maxAmount: 500000,
      }),
    ).toEqual({ errors: {}, amount: 150000 })
  })

  it('rejects unknown methods, bad amounts and overpayment', () => {
    expect(
      validateRecordPayment({ method: 'BITCOIN', amount: '1000', received: true }).errors,
    ).toHaveProperty('method')
    expect(
      validateRecordPayment({ method: 'CASH', amount: '0', received: true }).errors,
    ).toHaveProperty('amount')
    expect(
      validateRecordPayment({ method: 'CASH', amount: '12.5', received: true }).errors,
    ).toHaveProperty('amount')
    expect(
      validateRecordPayment({ method: 'CASH', amount: '', received: true }).errors,
    ).toHaveProperty('amount')
    const over = validateRecordPayment({
      method: 'CASH',
      amount: '600000',
      received: true,
      maxAmount: 500000,
    })
    expect(over.errors.amount).toMatch(/vượt quá số còn phải thu/)
    expect(over.amount).toBeNull()
  })
})
