import type { OrderAction } from '@/domain/orders/state-machine'

export interface ActionCopy {
  button: string
  title: string
  /** Explains the consequence in plain language (AGENTS §8: no generic "Bạn có chắc không?"). */
  consequence: (code: string) => string
  confirm: string
  reasonLabel?: string
}

export const ACTION_COPY: Record<OrderAction, ActionCopy> = {
  submit: {
    button: 'Gửi đơn',
    title: 'Gửi đơn',
    consequence: (code) =>
      `Gửi đơn ${code} để Admin xác nhận? Sau khi gửi, bạn không sửa được khách hàng, số lượng hay giá. Muốn sửa, hãy đưa đơn về nháp (khi chưa có thanh toán).`,
    confirm: 'Gửi đơn',
  },
  return_to_draft: {
    button: 'Đưa về nháp',
    title: 'Đưa đơn về nháp',
    consequence: (code) =>
      `Đưa đơn ${code} về nháp để sửa? Đơn sẽ không còn chờ Admin xác nhận cho đến khi bạn gửi lại.`,
    confirm: 'Đưa về nháp',
  },
  confirm: {
    button: 'Xác nhận đơn',
    title: 'Xác nhận đơn',
    consequence: (code) =>
      `Xác nhận đơn ${code}? Đơn chuyển sang chờ cọc; từ lúc này khách hàng, số lượng và giá không còn sửa được.`,
    confirm: 'Xác nhận',
  },
  cancel: {
    button: 'Hủy đơn',
    title: 'Hủy đơn',
    consequence: (code) =>
      `Hủy đơn ${code}? Hàng đang giữ (nếu có) sẽ được giải phóng và thao tác được lưu Audit Log. Muốn đặt lại, hãy tạo đơn mới.`,
    confirm: 'Hủy đơn',
    reasonLabel: 'Lý do hủy đơn',
  },
  void: {
    button: 'Vô hiệu hóa',
    title: 'Vô hiệu hóa đơn',
    consequence: (code) =>
      `Vô hiệu hóa đơn ${code}? Đơn không bị xóa khỏi hệ thống mà được đánh dấu "Đã vô hiệu hóa", hàng đang giữ sẽ được giải phóng và thao tác được lưu Audit Log.`,
    confirm: 'Vô hiệu hóa',
    reasonLabel: 'Lý do vô hiệu hóa',
  },
}
