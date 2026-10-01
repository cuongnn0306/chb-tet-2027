import { createContext, useContext } from 'react'
import type { AccessState } from '@/domain/auth/access'
import type { SignInResult } from '@/services/auth.service'

export interface AuthContextValue {
  access: AccessState
  signIn: (email: string, password: string) => Promise<SignInResult>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth phải được dùng bên trong AuthProvider')
  return value
}
