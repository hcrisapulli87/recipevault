import { useState } from 'react'
import type { JSX } from 'react'
import { signIn, requestPasswordReset } from '../data/auth'

export function SignInPage(): JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canSubmit = !!email.trim() && !!password && !busy

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    // On success AuthGate swaps to the app via onAuthChange — nothing to do here.
    if (error) setError(error)
  }

  const forgot = async (): Promise<void> => {
    if (!email.trim()) {
      setError('Enter your email above first, then tap "Forgot password?"')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error } = await requestPasswordReset(email.trim())
    setBusy(false)
    if (error) setError(error)
    else setNotice('Reset email sent — open the link, choose a new password, then sign in here.')
  }

  return (
    <div className="signin">
      <h1 className="signin__title">🍳 RecipeVault</h1>
      <p className="signin__tagline">Your recipes, meal plan, groceries & macros — everywhere.</p>
      <label className="field">
        <span className="field__label">Email</span>
        <input
          className="text-input"
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Password</span>
        <input
          className="text-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      {error && <div className="banner banner--error">{error}</div>}
      {notice && <div className="banner banner--ok">{notice}</div>}
      <button className="btn btn--primary" onClick={submit} disabled={!canSubmit}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <button className="btn" onClick={forgot} disabled={busy}>
        Forgot password?
      </button>
    </div>
  )
}
