import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { previewGroceries, addGroceries } from '../data/groceries'

type Phase = 'loading' | 'review' | 'saving' | 'done'

export function GroceryPreviewModal(props: {
  recipeIds: number[]
  scales: Record<number, number>
  onClose: () => void
}): JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [items, setItems] = useState<{ title: string; checked: boolean }[]>([])
  const [error, setError] = useState<string | null>(null)

  // Mounted fresh each open, so fetch the merged preview exactly once.
  useEffect(() => {
    previewGroceries(props.recipeIds, props.scales).then((titles) => {
      setItems(titles.map((title) => ({ title, checked: true })))
      setPhase('review')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (idx: number): void =>
    setItems(items.map((it, i) => (i === idx ? { ...it, checked: !it.checked } : it)))

  const selected = items.filter((it) => it.checked)

  const add = async (): Promise<void> => {
    setPhase('saving')
    setError(null)
    try {
      await addGroceries(selected.map((it) => it.title))
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save — try again.')
      setPhase('review')
    }
  }

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">🛒 Add to grocery list</h3>

        {phase === 'loading' && <p className="empty-note">Working out the list…</p>}

        {(phase === 'review' || phase === 'saving') && (
          <>
            {items.length === 0 ? (
              <p className="empty-note">No ingredients to add.</p>
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
                          disabled={phase === 'saving'}
                        />
                        <span>{it.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {error && <div className="banner banner--error">{error}</div>}
            <div className="modal__actions">
              <button className="btn" onClick={props.onClose} disabled={phase === 'saving'}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={add}
                disabled={phase === 'saving' || selected.length === 0}
              >
                {phase === 'saving'
                  ? 'Adding…'
                  : `Add ${selected.length} item${selected.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="banner banner--ok">Added to your grocery list.</div>
            <div className="modal__actions">
              <button className="btn btn--primary" onClick={props.onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
