import { useState } from 'react'
import type { JSX } from 'react'
import type { Page } from '../App'

const TABS: { page: Page; label: string; icon: string }[] = [
  { page: 'library', label: 'Recipes', icon: '📖' },
  { page: 'plan', label: 'Plan', icon: '🗓️' },
  { page: 'groceries', label: 'Groceries', icon: '🛒' },
  { page: 'tracker', label: 'Tracker', icon: '🥗' }
]
const MORE_PAGES: { page: Page; label: string; icon: string }[] = [
  { page: 'import', label: 'Import', icon: '🔗' },
  { page: 'settings', label: 'Settings', icon: '⚙️' }
]

export function MobileDock(props: { page: Page; onNavigate: (page: Page) => void }): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MORE_PAGES.some((t) => t.page === props.page)

  const go = (page: Page): void => {
    setMoreOpen(false)
    props.onNavigate(page)
  }

  return (
    <>
      {moreOpen && <div className="dock-sheet__backdrop" onClick={() => setMoreOpen(false)} />}
      {moreOpen && (
        <div className="dock-sheet">
          {MORE_PAGES.map((t) => (
            <button key={t.page} className="dock-sheet__item" onClick={() => go(t.page)}>
              <span aria-hidden="true">{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      )}
      <nav className="dock" aria-label="Primary">
        {TABS.map((t) => (
          <button
            key={t.page}
            className={`dock__tab ${props.page === t.page ? 'dock__tab--active' : ''}`}
            aria-label={t.label}
            title={t.label}
            onClick={() => go(t.page)}
          >
            {t.icon}
          </button>
        ))}
        <button
          className={`dock__tab ${moreActive ? 'dock__tab--active' : ''}`}
          aria-label="More"
          title="More"
          onClick={() => setMoreOpen((o) => !o)}
        >
          ⋯
        </button>
      </nav>
    </>
  )
}
