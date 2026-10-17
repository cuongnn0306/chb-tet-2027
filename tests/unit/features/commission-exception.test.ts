import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  hasPendingException,
  isNoPermission,
  submitApproval,
  validateApprovalReason,
} from '@/features/orders/commission-exception'
import { CommissionExceptionView } from '@/features/orders/components/CommissionExceptionView'
import { formatVnd } from '@/lib/money'
import type {
  ApproveCommissionExceptionResult,
  OrderCommissionEstimate,
} from '@/services/orders.service'

type ViewProps = ComponentProps<typeof CommissionExceptionView>

// Fixture: 500.000 list price at 5% after a cut = 25.000 base, 40.000 customer discount -> 15.000 borne by the company.
const pendingEstimate = (): OrderCommissionEstimate => ({
  order_id: 'order-1',
  basis: 'SNAPSHOT',
  is_final: true,
  resolved_on: '2026-10-17',
  seller_user_id: 'seller-1',
  seller_role_code: 'SALE_B2B',
  gross_amount: 500_000,
  discount_amount: 40_000,
  base_commission: 25_000,
  commission_funded_discount: 25_000,
  company_borne_excess: 15_000,
  final_commission: 0,
  discount_within_base_commission: false,
  exception: {
    status: 'PENDING',
    company_borne_excess: 15_000,
    approved_at: null,
    approval_reason: null,
  },
  commission_locked: true,
  lines: [],
})

const approvedEstimate = (reason: string | null): OrderCommissionEstimate => ({
  ...pendingEstimate(),
  exception: {
    status: 'APPROVED',
    company_borne_excess: 15_000,
    approved_at: '2026-10-17T08:00:00Z',
    approval_reason: reason,
  },
  commission_locked: false,
})

const render = (overrides: Partial<ViewProps> & Pick<ViewProps, 'state'>) =>
  renderToStaticMarkup(
    createElement(CommissionExceptionView, {
      isAdmin: true,
      reason: '',
      onReasonChange: () => undefined,
      onSubmit: () => undefined,
      submitting: false,
      notice: null,
      reasonError: null,
      ...overrides,
    }),
  )

const FORM_LABEL = 'Lý do duyệt ngoại lệ (bắt buộc)'
const APPROVE_BUTTON = 'Duyệt ngoại lệ và mở khóa hoa hồng'

describe('approval reason and outcome (COM-002)', () => {
  it('requires a nonblank reason', () => {
    expect(validateApprovalReason('')).toBe('Vui lòng nhập lý do duyệt ngoại lệ.')
    expect(validateApprovalReason('   \n ')).not.toBeNull()
    expect(validateApprovalReason(' Owner đồng ý ')).toBeNull()
  })

  it('does not call the service for a blank reason', async () => {
    const approve = vi.fn()
    const outcome = await submitApproval({ approveCommissionException: approve }, 'order-1', '  ')
    expect(outcome.kind).toBe('invalid')
    expect(approve).not.toHaveBeenCalled()
  })

  it('sends the trimmed reason and reports a first approval', async () => {
    const approve = vi.fn(async (): Promise<ApproveCommissionExceptionResult> => ({
      order_id: 'order-1',
      status: 'APPROVED',
      already_approved: false,
      approved_at: '2026-10-17T08:00:00Z',
    }))
    const outcome = await submitApproval(
      { approveCommissionException: approve },
      'order-1',
      '  Owner đồng ý  ',
    )
    expect(approve).toHaveBeenCalledWith('order-1', 'Owner đồng ý')
    expect(outcome).toMatchObject({ kind: 'approved' })
    expect(outcome.message).toContain('mở khóa')
  })

  it('treats a repeat or a concurrent approval by another Admin as already approved', async () => {
    const outcome = await submitApproval(
      {
        approveCommissionException: async () => ({
          order_id: 'order-1',
          status: 'APPROVED' as const,
          already_approved: true,
          approved_at: '2026-10-17T08:00:00Z',
        }),
      },
      'order-1',
      'Owner đồng ý',
    )
    expect(outcome).toMatchObject({ kind: 'already' })
    expect(outcome.message).toContain('đã được duyệt trước đó')
  })

  it('turns database failures into actionable Vietnamese without leaking details', async () => {
    const fail = (code: string) => ({
      approveCommissionException: async () => {
        throw Object.assign(new Error('raw sql detail'), { code })
      },
    })
    const denied = await submitApproval(fail('42501'), 'order-1', 'x')
    expect(denied).toEqual({
      kind: 'error',
      message: 'Bạn không có quyền thực hiện thao tác này.',
    })
    const missing = await submitApproval(fail('P0002'), 'order-1', 'x')
    expect(missing.message).toContain('không có ngoại lệ chiết khấu')
    const other = await submitApproval(fail('XX000'), 'order-1', 'x')
    expect(other.kind).toBe('error')
    expect(other.message).not.toContain('raw sql detail')
  })

  it('recognises the pending lock and the no-permission error', () => {
    expect(hasPendingException(pendingEstimate())).toBe(true)
    expect(hasPendingException(approvedEstimate('x'))).toBe(false)
    expect(isNoPermission({ code: '42501' })).toBe(true)
    expect(isNoPermission(new Error('network'))).toBe(false)
    expect(isNoPermission(null)).toBe(false)
  })
})

describe('commission exception panel (COM-002)', () => {
  it('shows the Admin the frozen figures, the lock and a reason-gated approval', () => {
    const html = render({ state: { kind: 'ready', estimate: pendingEstimate() } })
    expect(html).toContain('Ngoại lệ chiết khấu hoa hồng')
    expect(html).toContain('Đang khóa hoa hồng')
    expect(html).toContain('Hoa hồng gốc đã chốt')
    expect(html).toContain(formatVnd(25_000))
    expect(html).toContain('Chiết khấu của khách')
    expect(html).toContain(formatVnd(40_000))
    expect(html).toContain('Công ty chịu phần vượt')
    expect(html).toContain(formatVnd(15_000))
    expect(html).toContain('Đang khóa, chờ Admin duyệt')
    expect(html).toContain(FORM_LABEL)
    expect(html).toContain(APPROVE_BUTTON)
    // the consequence is spelled out before the Admin acts
    expect(html).toContain('Công ty chịu phần chiết khấu vượt hoa hồng')
    expect(html).toContain('không thể thấp hơn 0')
    expect(html).toContain('Audit Log')
  })

  it('shows the validation message and the busy state', () => {
    const html = render({
      state: { kind: 'ready', estimate: pendingEstimate() },
      reasonError: 'Vui lòng nhập lý do duyệt ngoại lệ.',
      submitting: true,
    })
    expect(html).toContain('Vui lòng nhập lý do duyệt ngoại lệ.')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled')
  })

  it('goes from pending to approved: the form disappears, the lock is released, the reason stays Admin-only', () => {
    const before = render({ state: { kind: 'ready', estimate: pendingEstimate() } })
    expect(before).toContain(APPROVE_BUTTON)

    const reason = 'Owner đồng ý chiết khấu vượt hoa hồng'
    const admin = render({
      state: { kind: 'ready', estimate: approvedEstimate(reason) },
      notice: { tone: 'success', message: 'Đã duyệt ngoại lệ.' },
    })
    expect(admin).toContain('Đã duyệt')
    expect(admin).toContain('Đã mở khóa')
    expect(admin).not.toContain(APPROVE_BUTTON)
    expect(admin).not.toContain(FORM_LABEL)
    expect(admin).toContain(`Lý do duyệt: </span>${reason}`)
    expect(admin).toContain('Đã duyệt ngoại lệ.')

    // Even if a reason slipped into the data, a salesperson never sees it.
    const seller = render({
      isAdmin: false,
      state: { kind: 'ready', estimate: approvedEstimate('bí mật của Admin') },
    })
    expect(seller).toContain('Đã mở khóa')
    expect(seller).not.toContain('bí mật của Admin')
    expect(seller).not.toContain('Lý do duyệt')
  })

  it('gives a salesperson the lock status and figures, but no Admin action', () => {
    const html = render({ isAdmin: false, state: { kind: 'ready', estimate: pendingEstimate() } })
    expect(html).toContain('Đang khóa, chờ Admin duyệt')
    expect(html).toContain(formatVnd(15_000))
    expect(html).toContain('Admin sẽ xem xét và duyệt ngoại lệ này')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('<button')
    expect(html).not.toContain(APPROVE_BUTTON)
    expect(html).not.toContain(FORM_LABEL)
  })

  it('shows an error notice for a failed approval and keeps the form', () => {
    const html = render({
      state: { kind: 'ready', estimate: pendingEstimate() },
      notice: { tone: 'error', message: 'Bạn không có quyền thực hiện thao tác này.' },
    })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Bạn không có quyền thực hiện thao tác này.')
    expect(html).toContain(APPROVE_BUTTON)
  })

  it('covers loading, error with retry, no permission and empty', () => {
    expect(render({ state: { kind: 'loading' } })).toContain('Đang tải hoa hồng…')

    const error = render({ state: { kind: 'error', onRetry: () => undefined } })
    expect(error).toContain('Không tải được thông tin hoa hồng')
    expect(error).toContain('Thử lại')

    const denied = render({ state: { kind: 'noPermission' } })
    expect(denied).toContain('Bạn không xem được hoa hồng của đơn này')
    expect(denied).not.toContain(APPROVE_BUTTON)

    const ordinary = { ...pendingEstimate(), exception: null, commission_locked: false }
    const empty = render({ state: { kind: 'ready', estimate: ordinary } })
    expect(empty).toContain('Không có ngoại lệ chiết khấu')
    expect(empty).not.toContain(APPROVE_BUTTON)
  })

  // Class-level guard only: it proves the narrow-screen layout classes are present, not that a phone was tested.
  it('uses a narrow-screen layout: wrapping labels, full-width field and button', () => {
    const html = render({ state: { kind: 'ready', estimate: pendingEstimate() } })
    expect(html).toContain('break-words')
    expect(html).toContain('grid-cols-[1fr_auto]')
    expect(html).toContain('w-full sm:w-auto')
    expect(html).toContain('min-h-11')
  })
})
