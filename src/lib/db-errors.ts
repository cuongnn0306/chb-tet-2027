/** Turns database/API errors into actionable Vietnamese messages. Never leaks SQL details. */
interface ErrorLike {
  code?: string
  message?: string
}

export function describeDbError(error: ErrorLike): string {
  switch (error.code) {
    // Business-rule errors raised by our own database functions already carry a Vietnamese message.
    case 'P0001':
      return error.message?.trim() || 'Thao tác không hợp lệ.'
    case '23505':
      return 'Dữ liệu này đã tồn tại (trùng mã hoặc trùng lựa chọn). Vui lòng kiểm tra lại.'
    case '23503':
      return 'Dữ liệu liên quan không còn tồn tại hoặc đang được sử dụng. Vui lòng tải lại trang.'
    case '23514':
      return 'Giá trị nhập vào không hợp lệ. Vui lòng kiểm tra lại.'
    case '42501':
      return 'Bạn không có quyền thực hiện thao tác này.'
    case 'PGRST116':
      return 'Không lưu được: bản ghi không còn tồn tại hoặc bạn không có quyền sửa.'
    default:
      return 'Không lưu được. Vui lòng thử lại hoặc liên hệ quản trị viên.'
  }
}
