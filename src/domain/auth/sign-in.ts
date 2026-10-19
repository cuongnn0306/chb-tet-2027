export type SignInFailure =
  'invalid_credentials' | 'inactive' | 'no_profile' | 'rate_limited' | 'network' | 'unknown'

/** Actionable Vietnamese messages for the login screen (PRD B9). Never reveal internal details. */
export const SIGN_IN_FAILURE_MESSAGES: Record<SignInFailure, string> = {
  invalid_credentials: 'Email hoặc mật khẩu không đúng. Vui lòng kiểm tra lại.',
  inactive: 'Tài khoản này đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.',
  no_profile: 'Tài khoản chưa được cấp quyền sử dụng hệ thống. Vui lòng liên hệ quản trị viên.',
  rate_limited: 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi ít phút rồi thử lại.',
  network: 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng rồi thử lại.',
  unknown: 'Không đăng nhập được. Vui lòng thử lại hoặc liên hệ quản trị viên.',
}

interface AuthErrorLike {
  code?: string
  status?: number
  name?: string
}

export function classifyAuthError(error: AuthErrorLike): SignInFailure {
  if (error.code === 'invalid_credentials') return 'invalid_credentials'
  if (error.code === 'over_request_rate_limit' || error.status === 429) return 'rate_limited'
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) return 'network'
  return 'unknown'
}
