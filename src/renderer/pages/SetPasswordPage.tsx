import { useState } from 'react'
import type { JSX } from 'react'
import { updatePassword } from '../data/auth'

/** Shown when the user arrives via a password-reset email link (PASSWORD_RECOVERY). */
export function SetPasswordPage({ onDone }: { onDone: () => void }): JSX.Element {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const canSubmit = !!password && !!confirm && !busy

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    if (password !== confirm) {
      setError('Passwords don’t match.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await updatePassword(password)
    setBusy(false)
    if (error) setError(error)
    else onDone()
  }

  return (
    <div className="signin glass-hero">
      <h1 className="signin__title">RecipeVault</h1>
      <p className="signin__tagline">Choose a new password for your account.</p>
      <label className="ffield">
        <span className="ffield__label">New password</span>
        <input
          className="input-field"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className="ffield">
        <span className="ffield__label">Confirm password</span>
        <input
          className="input-field"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      {error && <div className="info-banner info-banner--warm">{error}</div>}
      <button className="btn-primary" onClick={submit} disabled={!canSubmit}>
        {busy ? 'Saving…' : 'Set password'}
      </button>
    </div>
  )
}
