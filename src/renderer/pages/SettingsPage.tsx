import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { GoogleStatus, SettingsWithStatus } from '../../preload/index.d'

export function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<SettingsWithStatus | null>(null)
  const [google, setGoogle] = useState<GoogleStatus | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    window.api.googleStatus().then(setGoogle)
  }, [])

  if (!settings || !google) return <p className="empty-note">Loading…</p>

  const save = async (patch: Partial<SettingsWithStatus>): Promise<void> => {
    const next = { ...settings, ...patch }
    setSettings(next)
    const saved = await window.api.setSettings({
      botFolder: next.botFolder,
      groceriesList: next.groceriesList
    })
    setSettings(saved)
  }

  const signIn = async (): Promise<void> => {
    setSigningIn(true)
    setSignInError(null)
    const result = await window.api.googleSignIn()
    setSigningIn(false)
    if (result.ok) {
      setGoogle(result.data)
    } else {
      setSignInError(result.message)
    }
  }

  return (
    <div className="settings">
      <h2 className="page-header__title">Settings</h2>

      <section className="settings__section">
        <h3>Google Tasks (groceries)</h3>
        {!google.credentials ? (
          <div className="banner banner--warn">
            <code>google-credentials.json</code> not found. Copy the same OAuth client file the
            nanoblock tracker uses into RecipeVault’s data folder (
            <code>%APPDATA%\recipe-vault\</code>), then restart the app.
          </div>
        ) : google.signedIn ? (
          <p className="settings__status">
            ✓ Signed in — ingredients go to your “{settings.groceriesList}” list.
          </p>
        ) : (
          <button className="btn btn--primary" onClick={signIn} disabled={signingIn}>
            {signingIn ? 'Waiting for browser…' : 'Sign in to Google'}
          </button>
        )}
        {signInError && <div className="banner banner--error">{signInError}</div>}

        <label className="field">
          <span className="field__label">Groceries list name</span>
          <input
            className="text-input"
            value={settings.groceriesList}
            onChange={(e) => save({ groceriesList: e.target.value })}
          />
        </label>
      </section>

      <section className="settings__section">
        <h3>Discord bot sync</h3>
        <label className="field">
          <span className="field__label">Bot folder (holds meal_plan.json)</span>
          <input
            className="text-input settings__path"
            value={settings.botFolder}
            onChange={(e) => save({ botFolder: e.target.value })}
          />
        </label>
        {settings.botFolderExists ? (
          <p className="settings__status">✓ Folder found — the weekly plan syncs to !mealplan.</p>
        ) : (
          <div className="banner banner--warn">
            Folder not found. Meal planning still works in the app; it just won’t reach the Discord
            bot.
          </div>
        )}
      </section>
    </div>
  )
}
