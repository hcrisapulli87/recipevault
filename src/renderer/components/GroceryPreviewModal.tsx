import { useEffect, useState } from 'react'
import type { JSX } from 'react'

type Phase = 'loading' | 'review' | 'sending' | 'done' | 'error'

export function GroceryPreviewModal(props: {
  recipeIds: number[]
  scales: Record<number, number>
  onClose: () => void
}): JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [items, setItems] = useState<{ title: string; checked: boolean }[]>([])
  const [signedIn, setSignedIn] = useState(true)
  const [message, setMessage] = useState('')

  // The modal is mounted fresh each time it opens, so its inputs never change mid-life:
  // fetch the preview exactly once rather than re-running when the parent re-renders
  // (recipeIds/scales are recreated object literals on every parent render).
  useEffect(() => {
    Promise.all([
      window.api.previewGroceries({ recipeIds: props.recipeIds, scales: props.scales }),
      window.api.googleStatus()
    ]).then(([titles, status]) => {
      setItems(titles.map((title) => ({ title, checked: true })))
      setSignedIn(status.signedIn)
      setPhase('review')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (idx: number): void =>
    setItems(items.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it)))

  const selected = items.filter((it) => it.checked)

  const send = async (): Promise<void> => {
    setPhase('sending')
    if (!signedIn) {
      const auth = await window.api.googleSignIn()
      if (!auth.ok) {
        setMessage(auth.message)
        setPhase('error')
        return
      }
      setSignedIn(true)
    }
    const result = await window.api.sendGroceries(selected.map((it) => it.title))
    if (result.ok) {
      const { added, skipped } = result.data
      setMessage(
        `Added ${added} item${added === 1 ? '' : 's'}` +
          (skipped > 0 ? `, skipped ${skipped} already on the list.` : '.')
      )
      setPhase('done')
    } else {
      setMessage(result.message)
      setPhase('error')
    }
  }

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">🛒 Send to groceries</h3>

        {phase === 'loading' && <p className="empty-note">Working out the list…</p>}

        {(phase === 'review' || phase === 'sending') && (
          <>
            {items.length === 0 ? (
              <p className="empty-note">No ingredients to send.</p>
            ) : (
              <>
                <p className="modal__hint">Untick anything you already have in the cupboard:</p>
                <ul className="grocery-list">
                  {items.map((it, idx) => (
                    <li key={idx}>
                      <label className="grocery-list__item">
                        <input
                          type="checkbox"
                          checked={it.checked}
                          onChange={() => toggle(idx)}
                          disabled={phase === 'sending'}
                        />
                        <span>{it.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="modal__actions">
              <button className="btn" onClick={props.onClose} disabled={phase === 'sending'}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={send}
                disabled={phase === 'sending' || selected.length === 0}
              >
                {phase === 'sending'
                  ? 'Sending…'
                  : signedIn
                    ? `Add ${selected.length} item${selected.length === 1 ? '' : 's'} to Groceries`
                    : 'Sign in to Google & send'}
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="banner banner--ok">{message}</div>
            <div className="modal__actions">
              <button className="btn btn--primary" onClick={props.onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="banner banner--error">{message}</div>
            <div className="modal__actions">
              <button className="btn" onClick={props.onClose}>
                Close
              </button>
              <button className="btn btn--primary" onClick={send}>
                Retry
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
