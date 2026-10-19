import { describe, expect, it } from 'vitest'
import {
  ORDER_ACTION_RULES,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  TERMINAL_STATUSES,
  availableActions,
  canTransition,
  isEditable,
  isOrderStatus,
  type OrderStatus,
} from '@/domain/orders/state-machine'

describe('order state machine (ORD-008)', () => {
  it('has a Vietnamese label for every status', () => {
    for (const status of ORDER_STATUSES) expect(ORDER_STATUS_LABELS[status]).toBeTruthy()
  })

  it('follows the happy path in order', () => {
    const path: OrderStatus[] = [
      'DRAFT',
      'WAITING_CONFIRMATION',
      'WAITING_DEPOSIT',
      'CONFIRMED',
      'RESERVED',
      'PREPARING',
      'WAITING_DELIVERY',
      'COMPLETED',
    ]
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i] as OrderStatus, path[i + 1] as OrderStatus)).toBe(true)
    }
  })

  it('does not allow skipping steps or going backwards (except return to draft)', () => {
    expect(canTransition('DRAFT', 'CONFIRMED')).toBe(false)
    expect(canTransition('DRAFT', 'COMPLETED')).toBe(false)
    expect(canTransition('CONFIRMED', 'DRAFT')).toBe(false)
    expect(canTransition('WAITING_DEPOSIT', 'WAITING_CONFIRMATION')).toBe(false)
    expect(canTransition('WAITING_CONFIRMATION', 'DRAFT')).toBe(true)
  })

  it('makes cancelled, voided, returned and exchanged terminal', () => {
    for (const status of TERMINAL_STATUSES) expect(ORDER_TRANSITIONS[status]).toEqual([])
  })

  it('only lets completed orders be returned or exchanged', () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition(status, 'RETURNED')).toBe(status === 'COMPLETED')
      expect(canTransition(status, 'EXCHANGED')).toBe(status === 'COMPLETED')
    }
  })

  it('allows cancelling before delivery starts and voiding only before reservation', () => {
    for (const status of [
      'DRAFT',
      'WAITING_CONFIRMATION',
      'WAITING_DEPOSIT',
      'CONFIRMED',
      'RESERVED',
    ] as const) {
      expect(canTransition(status, 'CANCELLED')).toBe(true)
    }
    for (const status of ['PREPARING', 'WAITING_DELIVERY', 'COMPLETED'] as const) {
      expect(canTransition(status, 'CANCELLED')).toBe(false)
    }
    for (const status of [
      'DRAFT',
      'WAITING_CONFIRMATION',
      'WAITING_DEPOSIT',
      'CONFIRMED',
    ] as const) {
      expect(canTransition(status, 'VOIDED')).toBe(true)
    }
    expect(canTransition('RESERVED', 'VOIDED')).toBe(false)
  })

  it('only the draft is editable (confirmed quantities are frozen)', () => {
    for (const status of ORDER_STATUSES) expect(isEditable(status)).toBe(status === 'DRAFT')
  })

  it('recognises valid statuses only', () => {
    expect(isOrderStatus('DRAFT')).toBe(true)
    expect(isOrderStatus('draft')).toBe(false)
    expect(isOrderStatus(null)).toBe(false)
  })
})

describe('order actions', () => {
  it('every action targets a transition the machine allows', () => {
    for (const rule of Object.values(ORDER_ACTION_RULES)) {
      for (const from of rule.from) expect(canTransition(from, rule.to)).toBe(true)
    }
  })

  it('offers an owner submit/cancel on a draft but never confirm or void', () => {
    expect(availableActions('DRAFT', false)).toEqual(['submit', 'cancel'])
  })

  it('offers Admin everything valid, including confirm and void', () => {
    expect(availableActions('WAITING_CONFIRMATION', true)).toEqual([
      'return_to_draft',
      'confirm',
      'cancel',
      'void',
    ])
    expect(availableActions('DRAFT', true)).toEqual(['submit', 'cancel', 'void'])
  })

  it('stops an owner cancelling once the order is confirmed', () => {
    expect(availableActions('CONFIRMED', false)).toEqual([])
    expect(availableActions('CONFIRMED', true)).toEqual(['cancel', 'void'])
    expect(availableActions('RESERVED', true)).toEqual(['cancel'])
  })

  it('offers nothing for terminal or in-fulfilment orders', () => {
    for (const status of [
      'CANCELLED',
      'VOIDED',
      'COMPLETED',
      'PREPARING',
      'WAITING_DELIVERY',
    ] as const) {
      expect(availableActions(status, true)).toEqual([])
    }
  })
})
