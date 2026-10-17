import { describeDbError } from '@/lib/db-errors'
import type {
  ApproveCommissionExceptionResult,
  OrderCommissionEstimate,
} from '@/services/orders.service'

/**
 * UX-only helpers for the Admin approval of a commission discount exception (COM-002, Owner decision 17/10/2026).
 * The rules themselves (Admin only, nonblank reason, one audited approval, idempotent repeat) live in the
 * database RPC `approve_commission_discount_exception`; nothing here is trusted for security.
 */

export type ApprovalOutcome =
  | { kind: 'invalid'; message: string }
  | { kind: 'approved'; message: string }
  | { kind: 'already'; message: string }
  | { kind: 'error'; message: string }

/** Why the form cannot be submitted yet, or null. The database re-checks it. */
export function validateApprovalReason(reason: string): string | null {
  return reason.trim() === '' ? 'Vui lòng nhập lý do duyệt ngoại lệ.' : null
}

/** Is there an exception waiting for the Admin? */
export function hasPendingException(estimate: OrderCommissionEstimate): boolean {
  return estimate.commission_locked && estimate.exception?.status === 'PENDING'
}

interface ApprovalService {
  approveCommissionException(
    orderId: string,
    reason: string,
  ): Promise<ApproveCommissionExceptionResult>
}

/**
 * Calls the typed service and turns its result into a message. A repeat or a concurrent approval by another Admin
 * comes back as `already_approved` and is reported calmly: the exception is approved either way.
 */
export async function submitApproval(
  service: ApprovalService,
  orderId: string,
  reason: string,
): Promise<ApprovalOutcome> {
  const invalid = validateApprovalReason(reason)
  if (invalid) return { kind: 'invalid', message: invalid }
  try {
    const result = await service.approveCommissionException(orderId, reason.trim())
    return result.already_approved
      ? {
          kind: 'already',
          message:
            'Ngoại lệ này đã được duyệt trước đó (có thể do Admin khác). Không có gì thay đổi thêm.',
        }
      : {
          kind: 'approved',
          message:
            'Đã duyệt ngoại lệ. Hoa hồng của đơn đã được mở khóa và việc duyệt được lưu Audit Log.',
        }
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string }
    return {
      kind: 'error',
      message:
        code === 'P0002'
          ? 'Đơn này không có ngoại lệ chiết khấu cần duyệt. Vui lòng tải lại trang.'
          : describeDbError({ code, message }),
    }
  }
}

/** True when the failure of the estimate query means "not allowed to see this order's commission". */
export function isNoPermission(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42501'
}
