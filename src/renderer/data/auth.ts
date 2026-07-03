import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

/**
 * Subscribe to auth changes; returns an unsubscribe function. The raw event is
 * passed through so the gate can detect PASSWORD_RECOVERY (arriving via a
 * reset-email link) and show the set-new-password screen.
 */
export function onAuthChange(cb: (session: Session | null, event: string) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(session, event))
  return () => data.subscription.unsubscribe()
}

export async function signIn(email: string, password: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return { error: error?.message ?? null }
}

/**
 * Emails a password-reset link. redirectTo only applies where the app runs on
 * a real origin (the PWA); on the desktop build the origin is file://, which
 * Supabase won't allowlist, so it falls back to the project's Site URL — the
 * deployed PWA — which handles the recovery and the new password then works
 * everywhere, desktop included.
 */
export async function requestPasswordReset(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  })
  return { error: error?.message ?? null }
}

/** Set a new password for the signed-in user (used by the recovery screen). */
export async function updatePassword(password: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.updateUser({ password })
  return { error: error?.message ?? null }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

/** The signed-in user's email (used as a default profile display name). */
export async function currentUserEmail(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.email ?? null
}
