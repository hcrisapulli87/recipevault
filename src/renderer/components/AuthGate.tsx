import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, onAuthChange } from '../data/auth'
import { SignInPage } from '../pages/SignInPage'

/** Gates the app behind a Supabase session: signed out → sign-in screen, signed in → app. */
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSession().then((s) => {
      setSession(s)
      setLoading(false)
    })
    return onAuthChange(setSession)
  }, [])

  if (loading) return <p className="empty-note">Loading…</p>
  if (!session) return <SignInPage />
  return <>{children}</>
}
