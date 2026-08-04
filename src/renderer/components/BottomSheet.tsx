import type { JSX, ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * Glass bottom sheet over a dark scrim. `tall` pins it to 88% height (the Add
 * Food flow); otherwise it hugs its content. Scrim tap and the round ✕ close it.
 *
 * `footer` renders OUTSIDE the scrolling body, pinned to the bottom of the sheet. Action
 * rows placed in the body scroll away with the content and read as the last item of
 * whatever list they follow — which is exactly how the generator's Shuffle/Apply buttons
 * ended up looking like rows of the preview table.
 */
export function BottomSheet(props: {
  title?: string
  tall?: boolean
  footer?: ReactNode
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
        {props.footer && <div className="sheet__footer">{props.footer}</div>}
      </div>
    </div>
  )
}
