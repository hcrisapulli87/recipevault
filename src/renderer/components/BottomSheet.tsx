import type { JSX, ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Glass bottom sheet over a dark scrim. `tall` pins it to 88% height (the Add
 * Food flow); otherwise it hugs its content. Scrim tap and the round ✕ close it.
 */
export function BottomSheet(props: {
  title?: string
  tall?: boolean
  onClose: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className={`sheet ${props.tall ? 'sheet--tall' : ''}`} role="dialog" aria-modal="true">
        <div className="sheet__head">
          <span className="sheet__title">{props.title ?? ''}</span>
          <button className="round-btn" aria-label="Close" onClick={props.onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="sheet__body">{props.children}</div>
      </div>
    </div>
  )
}
