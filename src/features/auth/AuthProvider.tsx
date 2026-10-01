import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { resolveAccess, type AuthSnapshot, type CurrentProfile } from '@/domain/auth/access'
import type { AuthService } from '@/services/auth.service'
import { AuthContext, type AuthContextValue } from './auth-context'

interface Props {
  service: AuthService
  children: ReactNode
}

export function AuthProvider({ service, children }: Props) {
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [profile, setProfile] = useState<CurrentProfile | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  // Read the stored session once and follow later sign-in / sign-out / token refresh events.
  useEffect(() => {
    let cancelled = false
    void service.getSessionUserId().then((id) => {
      if (cancelled) return
      setUserId(id)
      setSessionLoaded(true)
    })
    const unsubscribe = service.onAuthStateChange((_event, id) => {
      setUserId(id)
      setSessionLoaded(true)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [service])

  // Load the profile of the signed-in user; `refreshTick` forces a re-check.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    service
      .loadCurrentProfile(userId)
      .catch(() => null) // could not verify the account: fail closed rather than keep stale access
      .then((loaded) => {
        if (cancelled) return
        setProfile(loaded)
        setLoadedFor(userId)
      })
    return () => {
      cancelled = true
    }
  }, [service, userId, refreshTick])

  // Re-check when the tab becomes visible again so a deactivated account is blocked promptly.
  useEffect(() => {
    if (!userId) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') setRefreshTick((tick) => tick + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [userId])

  const snapshot: AuthSnapshot = {
    sessionLoaded,
    userId,
    profileLoaded: userId !== null && loadedFor === userId,
    profile: loadedFor === userId ? profile : null,
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      access: resolveAccess(snapshot),
      signIn: async (email, password) => {
        const result = await service.signIn(email, password)
        if (result.ok) {
          setProfile(result.profile)
          setLoadedFor(result.profile.id)
        }
        return result
      },
      signOut: async () => {
        await service.signOut()
        setProfile(null)
        setLoadedFor(null)
      },
    }),
    // snapshot fields are the real dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [service, sessionLoaded, userId, loadedFor, profile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
