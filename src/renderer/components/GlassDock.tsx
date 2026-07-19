import { useState } from 'react'
import type { JSX } from 'react'
import {
  Gauge,
  TrendingUp,
  Book,
  MoreHorizontal,
  Plus,
  CalendarDays,
  ShoppingCart,
  Link2,
  Settings,
  ChevronRight
} from 'lucide-react'
import type { Page } from '../App'
import { BottomSheet } from './BottomSheet'

const TABS = [
  { page: 'tracker', label: 'Tracker', Icon: Gauge },
  { page: 'trends', label: 'Trends', Icon: TrendingUp },
  { page: 'library', label: 'Recipes', Icon: Book }
] as const

const MORE_ROWS = [
  { page: 'plan', label: 'Meal plan', sub: 'This week · shared', Icon: CalendarDays },
  { page: 'groceries', label: 'Groceries', sub: 'Shared shopping list', Icon: ShoppingCart },
  { page: 'import', label: 'Import recipe', sub: 'From a link or reel', Icon: Link2 },
  { page: 'settings', label: 'Settings', sub: 'Goals & account', Icon: Settings }
] as const

/**
 * Floating glass dock (Tracker · Trends · Recipes · More) + separate Add Food
 * FAB. More opens a bottom sheet of secondary destinations, not a screen.
 * The FAB is hidden while viewing the partner's read-only log.
 */
export function GlassDock(props: {
  page: Page
  showFab: boolean
  onNavigate: (page: Page) => void
  onAddFood: () => void
}): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MORE_ROWS.some((r) => r.page === props.page)

  const go = (page: Page): void => {
    setMoreOpen(false)
    props.onNavigate(page)
  }

  return (
    <>
      <div className="dockbar">
        <nav className="dock glass-pill" aria-label="Primary">
          {TABS.map(({ page, label, Icon }) => (
            <button
              key={page}
              className={`dock__tab ${props.page === page ? 'dock__tab--active' : ''}`}
              aria-label={label}
              onClick={() => go(page)}
            >
              <Icon size={21} strokeWidth={props.page === page ? 2.4 : 2} />
              <span className="dock__label">{label}</span>
            </button>
          ))}
          <button
            className={`dock__tab ${moreActive ? 'dock__tab--active' : ''}`}
            aria-label="More"
            onClick={() => setMoreOpen(true)}
          >
            <MoreHorizontal size={21} strokeWidth={moreActive ? 2.4 : 2} />
            <span className="dock__label">More</span>
          </button>
        </nav>
        {props.showFab && (
          <button className="fab" aria-label="Add food" onClick={props.onAddFood}>
            <Plus size={26} strokeWidth={2.4} />
          </button>
        )}
      </div>

      {moreOpen && (
        <BottomSheet title="More" onClose={() => setMoreOpen(false)}>
          <div className="more-rows">
            {MORE_ROWS.map(({ page, label, sub, Icon }) => (
              <button key={page} className="more-row" onClick={() => go(page)}>
                <span className="more-row__glyph">
                  <Icon size={19} />
                </span>
                <span className="more-row__text">
                  <span className="more-row__label">{label}</span>
                  <span className="more-row__sub">{sub}</span>
                </span>
                <ChevronRight size={18} className="more-row__chevron" />
              </button>
            ))}
          </div>
        </BottomSheet>
      )}
    </>
  )
}
