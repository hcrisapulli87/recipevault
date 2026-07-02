import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { getSession, signOut } from '../data/auth'

export function SettingsPage(): JSX.Element {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    getSession().then((s) => setEmail(s?.user.email ?? null))
  }, [])

  return (
    <div className="settings">
      <h2 className="page-header__title">Settings</h2>

      <section className="settings__section">
        <h3>Account</h3>
        {email ? (
          <p className="settings__status">✓ Signed in as {email}</p>
        ) : (
          <p className="empty-note">Loading…</p>
        )}
        <button className="btn" onClick={() => signOut()}>
          Sign out
        </button>
      </section>

      <section className="settings__section">
        <h3>Sync</h3>
        <p className="empty-note">
          Recipes, the meal plan, groceries and the tracker live in the cloud — sign in with the
          same email on your phone and this app and everything stays in sync automatically.
        </p>
      </section>
    </div>
  )
}
