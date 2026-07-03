import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, onAuthChange } from '../data/auth'
import { SignInPage } from '../pages/SignInPage'
import { SetPasswordPage } from '../pages/SetPasswordPage'

/**
 * Gates the app behind a Supabase session: signed out → sign-in screen, signed
 * in → app. Arriving via a password-reset email link signs the user in with a
 * PASSWORD_RECOVERY event; the gate holds them on the set-new-password screen
 * before letting them into the app.
 */
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [recovering, setRecovering] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSession().then((s) => {
      setSession(s)
      setLoading(false)
    })
    return onAuthChange((s, event) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
  }, [])

  if (loading) return <p className="empty-note">Loading…</p>
  if (!session) return <SignInPage />
  if (recovering) return <SetPasswordPage onDone={() => setRecovering(false)} />
  return <>{children}</>
}
