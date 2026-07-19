import type { JSX } from 'react'
import type { HouseholdUser } from '../data/users'

/**
 * H/K switcher: glass pill of initial circles; the active person is a dark ink
 * circle with white text. Renders nothing until both profiles exist (the
 * partner's row appears on their first sign-in).
 */
export function PersonSwitcher(props: {
  users: HouseholdUser[]
  selectedId: string
  onSelect: (user: HouseholdUser) => void
}): JSX.Element | null {
  if (props.users.length < 2) return null
  return (
    <div className="person-switch glass-pill">
      {props.users.map((u) => (
        <button
          key={u.id}
          className={`person-switch__btn ${u.id === props.selectedId ? 'person-switch__btn--active' : ''}`}
          aria-label={u.name}
          title={u.name}
          onClick={() => props.onSelect(u)}
        >
          {(u.name || '?').trim().charAt(0).toUpperCase()}
        </button>
      ))}
    </div>
  )
}
