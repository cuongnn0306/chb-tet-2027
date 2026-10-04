import { describe, expect, it } from 'vitest'
import { ROLE_CODES } from '@/domain/auth/roles'
import {
  MAX_LINE_QUANTITY,
  MAX_TRANSFER_LINES,
  MAX_TRANSFER_REASON_LENGTH,
  TRANSFER_STATUSES,
  TRANSFER_STATUS_LABELS,
  TRANSFER_STATUS_TONES,
  TRANSFER_TRANSITIONS,
  canProposeTransfer,
  canTransitionTransfer,
  isTransferStatus,
  parseTransferQuantity,
  validateTransferRequest,
  type TransferRequestInput,
} from '@/domain/transfers/transfers'

const SRC = '11111111-1111-4111-8111-111111111111'
const DST = '22222222-2222-4222-8222-222222222222'
const P1 = '33333333-3333-4333-8333-333333333333'
const P2 = '44444444-4444-4444-8444-444444444444'

const valid = (): TransferRequestInput => ({
  sourceLocationId: SRC,
  destinationLocationId: DST,
  lines: [{ productId: P1, quantity: 30 }],
  reason: 'Store A sắp hết hàng',
})

describe('vocabulary', () => {
  it('has a Vietnamese label and tone for every status', () => {
    for (const status of TRANSFER_STATUSES) {
      expect(TRANSFER_STATUS_LABELS[status]).toBeTruthy()
      expect(TRANSFER_STATUS_TONES[status]).toBeTruthy()
    }
    expect(isTransferStatus('REQUESTED')).toBe(true)
    expect(isTransferStatus('requested')).toBe(false)
    expect(isTransferStatus(undefined)).toBe(false)
  })
})

describe('state machine (TECH_DESIGN §8)', () => {
  const allowed: [string, string][] = [
    ['REQUESTED', 'APPROVED'],
    ['REQUESTED', 'REJECTED'],
    ['REQUESTED', 'CANCELLED'],
    ['APPROVED', 'DISPATCHED'],
    ['APPROVED', 'CANCELLED'],
    ['DISPATCHED', 'RECEIVED'],
  ]

  it('allows exactly the six approved edges', () => {
    const edges: [string, string][] = []
    for (const from of TRANSFER_STATUSES)
      for (const to of TRANSFER_STATUSES)
        if (canTransitionTransfer(from, to)) edges.push([from, to])
    expect(edges).toEqual(allowed)
  })

  it('cannot skip a state or leave a final state', () => {
    expect(canTransitionTransfer('REQUESTED', 'DISPATCHED')).toBe(false)
    expect(canTransitionTransfer('REQUESTED', 'RECEIVED')).toBe(false)
    expect(canTransitionTransfer('APPROVED', 'RECEIVED')).toBe(false)
    expect(canTransitionTransfer('DISPATCHED', 'CANCELLED')).toBe(false)
    for (const final of ['REJECTED', 'RECEIVED', 'CANCELLED'] as const) {
      expect(TRANSFER_TRANSITIONS[final]).toEqual([])
    }
  })
})

describe('canProposeTransfer (propose_transfer)', () => {
  it('is allowed for Admin, sales roles and Warehouse, not for Production', () => {
    const allowedRoles = ROLE_CODES.filter(canProposeTransfer)
    expect(allowedRoles).toEqual([
      'ADMIN',
      'SALE_B2B',
      'STORE_STAFF',
      'FRANCHISE_STAFF',
      'WAREHOUSE',
    ])
    expect(canProposeTransfer('PRODUCTION')).toBe(false)
  })
})

describe('parseTransferQuantity', () => {
  it('accepts whole numbers from 1 up to nine digits', () => {
    expect(parseTransferQuantity('30')).toBe(30)
    expect(parseTransferQuantity('  7 ')).toBe(7)
    expect(parseTransferQuantity(String(MAX_LINE_QUANTITY))).toBe(MAX_LINE_QUANTITY)
  })

  it.each(['', ' ', '0', '00', '-5', '+5', '1.5', '1,5', '1e3', 'abc', '1000000000'])(
    'rejects %j',
    (raw) => {
      expect(parseTransferQuantity(raw)).toBeNull()
    },
  )
})

describe('validateTransferRequest', () => {
  it('accepts a normal single-SKU request', () => {
    const result = validateTransferRequest(valid())
    expect(result.ok).toBe(true)
    expect(result.errors.line).toEqual({})
  })

  it('requires both locations and refuses the same one twice', () => {
    expect(validateTransferRequest({ ...valid(), sourceLocationId: '' }).errors.source).toMatch(
      /kho xuất/,
    )
    expect(
      validateTransferRequest({ ...valid(), destinationLocationId: '' }).errors.destination,
    ).toMatch(/kho nhận/)
    const same = validateTransferRequest({ ...valid(), destinationLocationId: SRC })
    expect(same.ok).toBe(false)
    expect(same.errors.destination).toMatch(/khác nhau/)
  })

  it('requires a reason within the limit', () => {
    expect(validateTransferRequest({ ...valid(), reason: '   ' }).errors.reason).toMatch(/lý do/i)
    const long = 'x'.repeat(MAX_TRANSFER_REASON_LENGTH + 1)
    expect(validateTransferRequest({ ...valid(), reason: long }).errors.reason).toMatch(/tối đa/)
    const edge = 'x'.repeat(MAX_TRANSFER_REASON_LENGTH)
    expect(validateTransferRequest({ ...valid(), reason: edge }).ok).toBe(true)
  })

  it('requires at least one line and caps the number of lines', () => {
    expect(validateTransferRequest({ ...valid(), lines: [] }).errors.lines).toMatch(/ít nhất/)
    const many = Array.from({ length: MAX_TRANSFER_LINES + 1 }, (_, i) => ({
      productId: `p-${i}`,
      quantity: 1,
    }))
    expect(validateTransferRequest({ ...valid(), lines: many }).errors.lines).toMatch(/tối đa/)
    expect(
      validateTransferRequest({ ...valid(), lines: many.slice(0, MAX_TRANSFER_LINES) }).ok,
    ).toBe(true)
  })

  it('checks every line: product chosen, positive whole quantity, no duplicate product', () => {
    const result = validateTransferRequest({
      ...valid(),
      lines: [
        { productId: '', quantity: 5 },
        { productId: P1, quantity: 0 },
        { productId: P2, quantity: null },
        { productId: P1, quantity: 3 },
        { productId: P2, quantity: 1.5 },
        { productId: 'p9', quantity: MAX_LINE_QUANTITY + 1 },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.errors.line[0]?.product).toMatch(/chọn sản phẩm/)
    expect(result.errors.line[1]?.quantity).toMatch(/lớn hơn 0/)
    expect(result.errors.line[2]?.quantity).toMatch(/lớn hơn 0/)
    expect(result.errors.line[3]?.product).toMatch(/một lần/)
    expect(result.errors.line[4]?.quantity).toMatch(/lớn hơn 0/)
    expect(result.errors.line[5]?.quantity).toMatch(/quá lớn/)
  })

  it('never reports a negative quantity as valid', () => {
    expect(
      validateTransferRequest({ ...valid(), lines: [{ productId: P1, quantity: -3 }] }).ok,
    ).toBe(false)
  })
})
