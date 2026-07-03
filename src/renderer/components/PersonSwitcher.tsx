import type { JSX } from 'react'
import type { HouseholdUser } from '../data/users'

/**
 * Me/partner toggle for pages with a read-only household view. Renders nothing
 * until both profiles exist (the partner's row appears on their first sign-in).
 */
export function PersonSwitcher(props: {
  users: HouseholdUser[]
  selectedId: string
  onSelect: (user: HouseholdUser) => void
}): JSX.Element | null {
  if (props.users.length < 2) return null
  return (
    <div className="tabs">
      {props.users.map((u) => (
        <button
          key={u.id}
          className={`tabs__tab ${u.id === props.selectedId ? 'tabs__tab--active' : ''}`}
          onClick={() => props.onSelect(u)}
        >
          {u.isMe ? 'Me' : u.name}
        </button>
      ))}
    </div>
  )
}
