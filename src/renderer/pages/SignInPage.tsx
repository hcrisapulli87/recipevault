import { useState } from 'react'
import type { JSX } from 'react'
import { sendMagicLink } from '../data/auth'

export function SignInPage(): JSX.Element {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!email.trim()) return
    setBusy(true)
    setError(null)
    const { error } = await sendMagicLink(email.trim())
    setBusy(false)
    if (error) setError(error)
    else setSent(true)
  }

  return (
    <div className="signin">
      <h1 className="signin__title">🍳 RecipeVault</h1>
      <p className="signin__tagline">Your recipes, meal plan, groceries & macros — everywhere.</p>
      {sent ? (
        <div className="banner banner--ok">
          Check your email for a sign-in link. Open it on this device to continue.
        </div>
      ) : (
        <>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="text-input"
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </label>
          {error && <div className="banner banner--error">{error}</div>}
          <button className="btn btn--primary" onClick={submit} disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Send magic link'}
          </button>
        </>
      )}
    </div>
  )
}
