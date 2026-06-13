import type { JSX } from 'react'
import type { Page } from '../App'

const NAV: { page: Page; label: string; icon: string }[] = [
  { page: 'library', label: 'Recipes', icon: '📖' },
  { page: 'plan', label: 'Meal Plan', icon: '🗓️' },
  { page: 'import', label: 'Import', icon: '🔗' },
  { page: 'settings', label: 'Settings', icon: '⚙️' }
]

export function Sidebar(props: {
  page: Page
  selectedRecipe: boolean
  onNavigate: (page: Page) => void
}): JSX.Element {
  return (
    <nav className="sidebar">
      <h1 className="sidebar__title">🍳 RecipeVault</h1>
      <div className="sidebar__section">
        {NAV.map((item) => (
          <button
            key={item.page}
            className={`sidebar__nav-btn ${
              props.page === item.page && !(item.page !== 'library' && props.selectedRecipe)
                ? 'sidebar__nav-btn--active'
                : ''
            }`}
            onClick={() => props.onNavigate(item.page)}
          >
            <span className="sidebar__nav-icon">{item.icon}</span> {item.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
