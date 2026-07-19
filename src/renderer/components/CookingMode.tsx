import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { X } from 'lucide-react'
import type { Recipe } from '../../shared/types'

/** Fullscreen blue cooking field: giant step numeral, one step at a time. */
export function CookingMode(props: { recipe: Recipe; onClose: () => void }): JSX.Element {
  const [current, setCurrent] = useState(0)
  const steps = props.recipe.steps
  const isLast = current === steps.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
      if (e.key === 'ArrowRight') setCurrent((c) => Math.min(c + 1, steps.length - 1))
      if (e.key === 'ArrowLeft') setCurrent((c) => Math.max(c - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props, steps.length])

  const step = steps[current]

  return (
    <div className="cooking">
      <div className="cooking__top">
        <span className="cooking__recipe">{props.recipe.title}</span>
        <button className="cooking__close" aria-label="Exit cooking mode" onClick={props.onClose}>
          <X size={18} strokeWidth={2.4} />
        </button>
      </div>

      <div className="cooking__center">
        <div className="cooking__num">{String(current + 1).padStart(2, '0')}</div>
        <div className="cooking__text">
          {step.section ? <span className="cooking__section">{step.section} — </span> : null}
          {step.text}
        </div>
      </div>

      <div className="cooking__footer">
        <span className="cooking__progress">
          Step {current + 1} of {steps.length}
        </span>
        <button
          className="cooking__back"
          style={current === 0 ? { opacity: 0.4 } : undefined}
          disabled={current === 0}
          onClick={() => setCurrent(current - 1)}
        >
          Back
        </button>
        <button
          className="cooking__next"
          onClick={() => (isLast ? props.onClose() : setCurrent(current + 1))}
        >
          {isLast ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  )
}
