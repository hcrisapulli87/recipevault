import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Recipe } from '../../shared/types'

export function CookingMode(props: { recipe: Recipe; onClose: () => void }): JSX.Element {
  const [current, setCurrent] = useState(0)
  const [done, setDone] = useState<Set<number>>(new Set())
  const steps = props.recipe.steps

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
      if (e.key === 'ArrowRight') setCurrent((c) => Math.min(c + 1, steps.length - 1))
      if (e.key === 'ArrowLeft') setCurrent((c) => Math.max(c - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props, steps.length])

  const toggleDone = (idx: number): void => {
    const next = new Set(done)
    if (next.has(idx)) {
      next.delete(idx)
    } else {
      next.add(idx)
    }
    setDone(next)
  }

  const step = steps[current]

  return (
    <div className="cooking">
      <button className="cooking__close" onClick={props.onClose} title="Exit (Esc)">
        ✕
      </button>
      <header className="cooking__header">
        <h2>{props.recipe.title}</h2>
        <span className="cooking__progress">
          Step {current + 1} of {steps.length}
          {step.section ? ` — ${step.section}` : ''}
        </span>
      </header>

      <button
        className={`cooking__step ${done.has(current) ? 'cooking__step--done' : ''}`}
        onClick={() => toggleDone(current)}
        title="Click to mark done"
      >
        {step.text}
      </button>

      <footer className="cooking__nav">
        <button
          className="btn"
          onClick={() => setCurrent(current - 1)}
          disabled={current === 0}
        >
          ← Previous
        </button>
        <div className="cooking__dots">
          {steps.map((_, idx) => (
            <button
              key={idx}
              className={`cooking__dot ${idx === current ? 'cooking__dot--current' : ''} ${
                done.has(idx) ? 'cooking__dot--done' : ''
              }`}
              onClick={() => setCurrent(idx)}
            />
          ))}
        </div>
        <button
          className="btn btn--primary"
          onClick={() => setCurrent(current + 1)}
          disabled={current === steps.length - 1}
        >
          Next →
        </button>
      </footer>
    </div>
  )
}
