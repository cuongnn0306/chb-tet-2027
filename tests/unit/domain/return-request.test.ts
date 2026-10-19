import { describe, expect, it, vi } from 'vitest'
import {
  MAX_LINE_QUANTITY,
  MAX_RETURN_LINES,
  MAX_RETURN_REASON_LENGTH,
  RETURN_STATUSES,
  RETURN_STATUS_LABELS,
  RETURN_STATUS_TONES,
  RETURN_TRANSITIONS,
  canRequestReturn,
  canTransitionReturn,
  isOrderReturnable,
  isReturnStatus,
  parseReturnQuantity,
  returnableQuantity,
  validateReturnRequest,
  type ReturnRequestInput,
  type ReturnableLine,
} from '@/domain/returns/request'
import { ROLE_CODES } from '@/domain/auth/roles'
import type { AppSupabaseClient } from '@/lib/supabase'
import { DbError } from '@/services/crud.service'
import { ReturnInputError, createReturnService } from '@/services/returns.service'

const ORDER = '11111111-1111-4111-8111-111111111111'
const LINE_A = '22222222-2222-4222-8222-222222222222'
const LINE_B = '33333333-3333-4333-8333-333333333333'

const valid = (over: Partial<ReturnRequestInput> = {}): ReturnRequestInput => ({
  orderId: ORDER,
  lines: [{ orderItemId: LINE_A, quantity: 3 }],
  reason: 'Khách báo bánh bị móp khi nhận',
  ...over,
})

const counting = (over: Partial<ReturnableLine> = {}): ReturnableLine => ({
  deliveredQuantity: 10,
  returnedQuantity: 0,
  requestedQuantity: 0,
  ...over,
})

describe('returnableQuantity (cumulative cap against delivered quantity)', () => {
  it('is delivered minus what is already requested', () => {
    expect(returnableQuantity(counting())).toBe(10)
    expect(returnableQuantity(counting({ requestedQuantity: 4 }))).toBe(6)
    expect(returnableQuantity(counting({ requestedQuantity: 10 }))).toBe(0)
  })

  it('does not double count a request that a later task also copied into returned_quantity', () => {
    expect(returnableQuantity(counting({ requestedQuantity: 4, returnedQuantity: 4 }))).toBe(6)
  })

  it('uses the larger of returned and requested', () => {
    expect(returnableQuantity(counting({ requestedQuantity: 2, returnedQuantity: 5 }))).toBe(5)
    expect(returnableQuantity(counting({ requestedQuantity: 7, returnedQuantity: 1 }))).toBe(3)
  })

  it('is zero for an undelivered line and never negative', () => {
    expect(returnableQuantity(counting({ deliveredQuantity: 0 }))).toBe(0)
    expect(returnableQuantity(counting({ requestedQuantity: 99 }))).toBe(0)
  })
})

describe('validateReturnRequest', () => {
  it('accepts a request with a reason, a real line and a positive quantity', () => {
    expect(validateReturnRequest(valid())).toEqual({ ok: true, errors: { line: {} } })
  })

  it('requires an order', () => {
    const { ok, errors } = validateReturnRequest(valid({ orderId: '' }))
    expect(ok).toBe(false)
    expect(errors.order).toMatch(/đơn hàng/)
  })

  it('requires a non-blank reason of at most 500 characters', () => {
    expect(validateReturnRequest(valid({ reason: '' })).errors.reason).toMatch(/lý do/)
    expect(validateReturnRequest(valid({ reason: '   \n\t ' })).errors.reason).toMatch(/lý do/)
    const atLimit = 'a'.repeat(MAX_RETURN_REASON_LENGTH)
    expect(validateReturnRequest(valid({ reason: atLimit })).ok).toBe(true)
    expect(validateReturnRequest(valid({ reason: `  ${atLimit}  ` })).ok).toBe(true)
    expect(validateReturnRequest(valid({ reason: `${atLimit}a` })).errors.reason).toMatch(
      /tối đa 500/,
    )
  })

  it('requires 1..50 lines', () => {
    expect(validateReturnRequest(valid({ lines: [] })).errors.lines).toMatch(/ít nhất một sản phẩm/)
    const many = Array.from({ length: MAX_RETURN_LINES + 1 }, (_, i) => ({
      orderItemId: `item-${i}`,
      quantity: 1,
    }))
    expect(validateReturnRequest(valid({ lines: many })).errors.lines).toMatch(/tối đa 50/)
    expect(validateReturnRequest(valid({ lines: many.slice(0, MAX_RETURN_LINES) })).ok).toBe(true)
  })

  it('rejects zero, negative, fractional, empty and oversized quantities', () => {
    const quantity = (value: number | null) =>
      validateReturnRequest(valid({ lines: [{ orderItemId: LINE_A, quantity: value }] })).errors
        .line[0]?.quantity
    expect(quantity(0)).toMatch(/lớn hơn 0/)
    expect(quantity(-2)).toMatch(/lớn hơn 0/)
    expect(quantity(1.5)).toMatch(/lớn hơn 0/)
    expect(quantity(null)).toMatch(/lớn hơn 0/)
    expect(quantity(Number.NaN)).toMatch(/lớn hơn 0/)
    expect(quantity(MAX_LINE_QUANTITY + 1)).toMatch(/quá lớn/)
    expect(quantity(1)).toBeUndefined()
    expect(quantity(MAX_LINE_QUANTITY)).toBeUndefined()
  })

  it('requires a chosen line and refuses the same line twice', () => {
    const missing = validateReturnRequest(valid({ lines: [{ orderItemId: '', quantity: 1 }] }))
    expect(missing.errors.line[0]?.item).toMatch(/chọn sản phẩm/)
    const twice = validateReturnRequest(
      valid({
        lines: [
          { orderItemId: LINE_A, quantity: 1 },
          { orderItemId: LINE_A, quantity: 2 },
        ],
      }),
    )
    expect(twice.ok).toBe(false)
    expect(twice.errors.line[0]).toBeUndefined()
    expect(twice.errors.line[1]?.item).toMatch(/một lần/)
  })

  describe('with the counting inputs the screen already has', () => {
    const known = {
      [LINE_A]: counting({ deliveredQuantity: 10, requestedQuantity: 4 }),
      [LINE_B]: counting({ deliveredQuantity: 0 }),
    }
    const asked = (orderItemId: string, quantity: number) =>
      validateReturnRequest(valid({ lines: [{ orderItemId, quantity }] }), known)

    it('lets a request up to the remaining quantity through', () => {
      expect(asked(LINE_A, 6).ok).toBe(true)
    })

    it('refuses more than what is left and says how much is left', () => {
      const result = asked(LINE_A, 7)
      expect(result.ok).toBe(false)
      expect(result.errors.line[0]?.quantity).toMatch(/tối đa 6 \(đã giao 10\)/)
    })

    it('says so when everything delivered is already returned or requested', () => {
      const result = validateReturnRequest(
        valid({ lines: [{ orderItemId: LINE_A, quantity: 1 }] }),
        { [LINE_A]: counting({ requestedQuantity: 10 }) },
      )
      expect(result.errors.line[0]?.quantity).toMatch(/đã có yêu cầu trả hết/)
    })

    it('refuses a line that was never delivered', () => {
      expect(asked(LINE_B, 1).errors.line[0]?.item).toMatch(/chưa được giao/)
    })

    it('refuses a line that is not part of the order', () => {
      expect(asked('44444444-4444-4444-8444-444444444444', 1).errors.line[0]?.item).toMatch(
        /không thuộc đơn hàng/,
      )
    })
  })
})

describe('parseReturnQuantity', () => {
  it('accepts plain whole numbers of one to nine digits', () => {
    expect(parseReturnQuantity('1')).toBe(1)
    expect(parseReturnQuantity('  25 ')).toBe(25)
    expect(parseReturnQuantity('999999999')).toBe(MAX_LINE_QUANTITY)
  })

  it('rejects everything else', () => {
    for (const raw of ['', ' ', '0', '00', '-1', '+1', '1.5', '1,5', '1e3', 'abc', '1000000000']) {
      expect(parseReturnQuantity(raw), raw).toBeNull()
    }
  })
})

describe('return state machine (TECH_DESIGN §11)', () => {
  it('has the five specified statuses with a label and a tone each', () => {
    expect([...RETURN_STATUSES]).toEqual([
      'REQUESTED',
      'RECEIVED_PENDING_INSPECTION',
      'RESTOCKED',
      'DAMAGED',
      'CLOSED',
    ])
    for (const status of RETURN_STATUSES) {
      expect(RETURN_STATUS_LABELS[status]).toBeTruthy()
      expect(RETURN_STATUS_TONES[status]).toBeTruthy()
    }
    expect(isReturnStatus('REQUESTED')).toBe(true)
    expect(isReturnStatus('APPROVED')).toBe(false)
    expect(isReturnStatus(undefined)).toBe(false)
  })

  it('allows exactly the specified edges', () => {
    const edges: [string, string][] = [
      ['REQUESTED', 'RECEIVED_PENDING_INSPECTION'],
      ['RECEIVED_PENDING_INSPECTION', 'RESTOCKED'],
      ['RECEIVED_PENDING_INSPECTION', 'DAMAGED'],
      ['RESTOCKED', 'CLOSED'],
      ['DAMAGED', 'CLOSED'],
    ]
    for (const from of RETURN_STATUSES) {
      for (const to of RETURN_STATUSES) {
        const expected = edges.some(([a, b]) => a === from && b === to)
        expect(canTransitionReturn(from, to), `${from} -> ${to}`).toBe(expected)
      }
    }
    expect(RETURN_TRANSITIONS.CLOSED).toEqual([])
  })

  it('never lets a request skip receiving and inspection', () => {
    expect(canTransitionReturn('REQUESTED', 'RESTOCKED')).toBe(false)
    expect(canTransitionReturn('REQUESTED', 'DAMAGED')).toBe(false)
    expect(canTransitionReturn('REQUESTED', 'CLOSED')).toBe(false)
  })
})

describe('who and what may be returned', () => {
  it('only the Admin may request a return (no permission is invented for other roles)', () => {
    expect(ROLE_CODES.filter(canRequestReturn)).toEqual(['ADMIN'])
    expect(canRequestReturn('')).toBe(false)
    expect(canRequestReturn('admin')).toBe(false)
  })

  it('only a completed order is returnable', () => {
    expect(isOrderReturnable('COMPLETED')).toBe(true)
    for (const status of [
      'DRAFT',
      'WAITING_CONFIRMATION',
      'WAITING_DEPOSIT',
      'CONFIRMED',
      'RESERVED',
      'PREPARING',
      'WAITING_DELIVERY',
      'CANCELLED',
      'VOIDED',
      'RETURNED',
      'EXCHANGED',
    ]) {
      expect(isOrderReturnable(status), status).toBe(false)
    }
  })
})

describe('returns service (client-side behaviour; the database rules are in the integration test)', () => {
  const stub = (result: { data: unknown; error: { code?: string; message: string } | null }) => {
    const rpc = vi.fn(async () => result)
    return { rpc, service: createReturnService({ rpc } as unknown as AppSupabaseClient) }
  }

  it('does not call the database for a request that is already known to be invalid', async () => {
    const { rpc, service } = stub({ data: null, error: null })
    await expect(service.request(valid({ reason: '  ' }))).rejects.toBeInstanceOf(ReturnInputError)
    await expect(
      service.request(valid({ lines: [{ orderItemId: LINE_A, quantity: 0 }] })),
    ).rejects.toThrow(/chưa hợp lệ/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sends one RPC with snake_case arguments and a trimmed reason, and nothing else', async () => {
    const created = { id: 'r1', status: 'REQUESTED', items: [] }
    const { rpc, service } = stub({ data: created, error: null })
    const result = await service.request(
      valid({
        reason: '  Hàng bị hỏng khi giao  ',
        lines: [
          { orderItemId: LINE_A, quantity: 2 },
          { orderItemId: LINE_B, quantity: 5 },
        ],
      }),
    )
    expect(result).toBe(created)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('request_return', {
      p_order_id: ORDER,
      p_items: [
        { order_item_id: LINE_A, quantity: 2 },
        { order_item_id: LINE_B, quantity: 5 },
      ],
      p_reason: 'Hàng bị hỏng khi giao',
    })
  })

  it('surfaces a database refusal as a DbError that keeps the SQLSTATE', async () => {
    const { service } = stub({
      data: null,
      error: { code: '42501', message: 'Chỉ Admin được tạo yêu cầu trả hàng.' },
    })
    const error = await service.request(valid()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DbError)
    expect(error).toMatchObject({ code: '42501', message: 'Chỉ Admin được tạo yêu cầu trả hàng.' })
  })
})
