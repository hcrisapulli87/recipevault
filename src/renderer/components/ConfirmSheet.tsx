import type { JSX } from 'react'
import { BottomSheet } from './BottomSheet'

/**
 * Confirmation for destructive actions. A glass sheet rather than `window.confirm` —
 * the native dialog is chrome from a browser the standalone PWA is pretending not to be,
 * and on iOS it lands as a system alert with the site's URL in it.
 */
export function ConfirmSheet(props: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <BottomSheet
      title={props.title}
      onClose={props.onClose}
      footer={
        <div className="confirm__actions">
          <button className="btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button
            className="btn-primary btn-primary--destructive"
            onClick={() => {
              props.onConfirm()
              props.onClose()
            }}
          >
            {props.confirmLabel}
          </button>
        </div>
      }
    >
      <p className="confirm__body">{props.body}</p>
    </BottomSheet>
  )
}
