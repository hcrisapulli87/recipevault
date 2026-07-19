import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Check } from 'lucide-react'
import { previewGroceries, addGroceries } from '../data/groceries'
import { BottomSheet } from './BottomSheet'
import { useToast } from './Toast'

type Phase = 'loading' | 'review' | 'saving'

/**
 * Review sheet for "send to groceries": merged, deduped ingredients arrive
 * ticked; untick cupboard staples, send the rest. Ends in a toast, not a
 * confirmation screen.
 */
export function GroceryPreviewModal(props: {
  recipeIds: number[]
  scales: Record<number, number>
  onClose: () => void
}): JSX.Element {
  const toast = useToast()
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
      toast(
        `${selected.length} ingredient${selected.length === 1 ? '' : 's'} sent to groceries`
      )
      props.onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save — try again.')
      setPhase('review')
    }
  }

  return (
    <BottomSheet title="Send to groceries" onClose={props.onClose}>
      {phase === 'loading' && <p className="addfood__note">Working out the list…</p>}

      {phase !== 'loading' && (
        <div className="grocery-preview">
          {items.length === 0 ? (
            <p className="addfood__note">No ingredients to add.</p>
          ) : (
            <>
              <p className="grocery-preview__hint">
                Untick anything you already have in the cupboard:
              </p>
              <div className="grocery-preview__list">
                {items.map((it, idx) => (
                  <button
                    key={idx}
                    className="grocery-row"
                    disabled={phase === 'saving'}
                    onClick={() => toggle(idx)}
                  >
                    <span
                      className={`grocery-row__circle ${it.checked ? 'grocery-row__circle--on' : ''}`}
                    >
                      {it.checked && <Check size={13} strokeWidth={3} />}
                    </span>
                    <span className="grocery-row__label">{it.title}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {error && <div className="info-banner info-banner--warm">{error}</div>}
          <button
            className="btn-primary grocery-preview__send"
            onClick={add}
            disabled={phase === 'saving' || selected.length === 0}
          >
            {phase === 'saving'
              ? 'Sending…'
              : `Send ${selected.length} item${selected.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    </BottomSheet>
  )
}
