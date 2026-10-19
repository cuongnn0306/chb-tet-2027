import { describe, expect, it } from 'vitest'
import {
  DELIVERY_ACTION_NEEDS_REASON,
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONES,
  addDays,
  allocationOutcomeMessage,
  availableDeliveryActions,
  canAllocateDelivery,
  boardRange,
  canPlanDelivery,
  canReschedule,
  groupByDate,
  isDeliveryEditable,
  isDeliveryStatus,
  unassignedQuantity,
  validateDeliveryPlan,
  vietnamToday,
} from '@/domain/deliveries/deliveries'

const warehouse = { isWarehouseStaff: true, isPlanner: false }
const owner = { isWarehouseStaff: false, isPlanner: true }
const admin = { isWarehouseStaff: true, isPlanner: true }

describe('delivery vocabulary', () => {
  it('labels and tones every status', () => {
    for (const s of DELIVERY_STATUSES) {
      expect(DELIVERY_STATUS_LABELS[s]).toBeTruthy()
      expect(DELIVERY_STATUS_TONES[s]).toBeTruthy()
    }
    expect(isDeliveryStatus('READY')).toBe(true)
    expect(isDeliveryStatus('SHIPPED')).toBe(false)
  })

  it('requires a reason only for fail and cancel', () => {
    expect(DELIVERY_ACTION_NEEDS_REASON).toMatchObject({
      fail: true,
      cancel: true,
      deliver: false,
    })
  })
})

describe('available actions', () => {
  it('lets warehouse staff move the physical flow forward', () => {
    expect(availableDeliveryActions('PREPARING', warehouse)).toEqual(['ready'])
    expect(availableDeliveryActions('READY', warehouse)).toEqual(['dispatch'])
    expect(availableDeliveryActions('OUT_FOR_DELIVERY', warehouse)).toEqual(['deliver', 'fail'])
    expect(availableDeliveryActions('DELIVERED', warehouse)).toEqual([])
  })

  it('lets the owner cancel only before the goods leave', () => {
    expect(availableDeliveryActions('PREPARING', owner)).toEqual(['cancel'])
    expect(availableDeliveryActions('READY', owner)).toEqual(['cancel'])
    expect(availableDeliveryActions('OUT_FOR_DELIVERY', owner)).toEqual([])
    expect(availableDeliveryActions('READY', admin)).toEqual(['dispatch', 'cancel'])
  })

  it('does not let anyone cancel a delivery whose goods are in logistics (DEL-012)', () => {
    // a FAILED delivery rescheduled back to READY still has its goods out of the warehouse
    expect(availableDeliveryActions('READY', owner, true)).toEqual([])
    expect(availableDeliveryActions('READY', admin, true)).toEqual(['dispatch'])
    expect(availableDeliveryActions('READY', owner, false)).toEqual(['cancel'])
    expect(availableDeliveryActions('FAILED', admin, true)).toEqual([])
  })

  it('reschedules a failed delivery and editing is for PREPARING only', () => {
    expect(canReschedule('FAILED', true)).toBe(true)
    expect(canReschedule('FAILED', false)).toBe(false)
    expect(canReschedule('DELIVERED', true)).toBe(false)
    expect(isDeliveryEditable('PREPARING')).toBe(true)
    expect(isDeliveryEditable('READY')).toBe(false)
  })

  it('stops planning once the order is closed', () => {
    expect(canPlanDelivery('RESERVED')).toBe(true)
    expect(canPlanDelivery('COMPLETED')).toBe(false)
    expect(canPlanDelivery('VOIDED')).toBe(false)
  })
})

describe('quantities and plan validation', () => {
  it('never reports a negative unassigned quantity', () => {
    expect(unassignedQuantity(10, 4)).toBe(6)
    expect(unassignedQuantity(10, 12)).toBe(0)
  })

  const valid = {
    scheduledDate: '2026-12-20',
    today: '2026-12-01',
    method: 'CHB_DELIVERY' as const,
    address: '12 Phố Huế',
    lines: [{ quantity: 3, max: 5, name: 'Bánh 1kg' }],
  }

  it('accepts a complete plan', () => {
    expect(validateDeliveryPlan(valid)).toEqual({})
  })

  it('rejects a past date, a missing address and empty or excessive quantities', () => {
    expect(validateDeliveryPlan({ ...valid, scheduledDate: '2026-11-30' }).scheduledDate).toMatch(
      /từ hôm nay/,
    )
    expect(validateDeliveryPlan({ ...valid, address: ' ' }).address).toMatch(/địa chỉ/)
    expect(
      validateDeliveryPlan({ ...valid, lines: [{ quantity: 0, max: 5, name: 'A' }] }).lines,
    ).toMatch(/ít nhất một/)
    expect(
      validateDeliveryPlan({ ...valid, lines: [{ quantity: 6, max: 5, name: 'A' }] }).lines,
    ).toMatch(/chỉ còn có thể giao thêm 5/)
    expect(
      validateDeliveryPlan({ ...valid, lines: [{ quantity: 1.5, max: 5, name: 'A' }] }).lines,
    ).toMatch(/số nguyên/)
  })

  it('does not need an address for customer pickup', () => {
    expect(validateDeliveryPlan({ ...valid, method: 'CUSTOMER_PICKUP', address: '' })).toEqual({})
  })
})

describe('dates', () => {
  it('computes the Vietnam date, not the UTC one', () => {
    // 18:00 UTC on 1 Dec is already 2 Dec in Vietnam (UTC+7)
    expect(vietnamToday(new Date('2026-12-01T18:00:00Z'))).toBe('2026-12-02')
    expect(vietnamToday(new Date('2026-12-01T10:00:00Z'))).toBe('2026-12-01')
  })

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2027-02-27', 2)).toBe('2027-03-01')
    expect(addDays('2026-12-01', -1)).toBe('2026-11-30')
  })

  it('builds the board ranges', () => {
    expect(boardRange('today', '2026-12-01')).toEqual({ from: '2026-12-01', to: '2026-12-01' })
    expect(boardRange('tomorrow', '2026-12-01')).toEqual({ from: '2026-12-02', to: '2026-12-02' })
    expect(boardRange('week', '2026-12-01')).toEqual({ from: '2026-12-01', to: '2026-12-07' })
    expect(boardRange('month', '2026-12-01').to).toBe('2026-12-31')
  })

  it('groups rows by day in ascending order', () => {
    const rows = [
      { scheduled_date: '2026-12-03', id: 'c' },
      { scheduled_date: '2026-12-01', id: 'a' },
      { scheduled_date: '2026-12-03', id: 'd' },
    ]
    expect(groupByDate(rows).map(([day, list]) => [day, list.map((r) => r.id)])).toEqual([
      ['2026-12-01', ['a']],
      ['2026-12-03', ['c', 'd']],
    ])
  })
})

describe('allocation per delivery (DEL-005)', () => {
  it('lets only Admin/Warehouse allocate a delivery that has not left the warehouse', () => {
    expect(canAllocateDelivery('PREPARING', 'RESERVED', true)).toBe(true)
    expect(canAllocateDelivery('READY', 'CONFIRMED', true)).toBe(true)
    expect(canAllocateDelivery('READY', 'WAITING_DELIVERY', true)).toBe(true)
    // Sales roles never allocate
    expect(canAllocateDelivery('PREPARING', 'RESERVED', false)).toBe(false)
    // goods already out / closed deliveries
    for (const s of ['OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED'] as const) {
      expect(canAllocateDelivery(s, 'RESERVED', true)).toBe(false)
    }
    // orders that are not confirmed yet or already closed
    for (const o of ['DRAFT', 'WAITING_DEPOSIT', 'COMPLETED', 'CANCELLED']) {
      expect(canAllocateDelivery('READY', o, true)).toBe(false)
    }
  })

  it('explains the outcome in Vietnamese', () => {
    const base = { fully_allocated: true, shortage_total: 0, allocated_total: 0, released_total: 0 }
    expect(
      allocationOutcomeMessage({ ...base, allocated_total: 5, released_total: 5 }, 'X'),
    ).toEqual({
      tone: 'success',
      text: 'Đã giữ 5 cái tại kho X cho đợt giao này. Đã giải phóng 5 cái đơn đang giữ thừa ở kho khác.',
    })
    expect(allocationOutcomeMessage(base, 'X').text).toContain('không cần phân bổ thêm')
    const short = allocationOutcomeMessage(
      { ...base, fully_allocated: false, shortage_total: 3 },
      'Y',
    )
    expect(short.tone).toBe('warning')
    expect(short.text).toContain('thiếu 3 cái')
    expect(short.text).toContain('các kho khác không bị ảnh hưởng')
  })
})
