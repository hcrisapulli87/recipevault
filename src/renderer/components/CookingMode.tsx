import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, TouchEvent } from 'react'
import { Check, ListChecks, Pause, Play, Timer, X } from 'lucide-react'
import type { Recipe } from '../../shared/types'
import { formatScaledIngredient } from '../../shared/ingredient-parser'
import { ingredientsForStep } from '../../shared/step-ingredients'
import { formatCountdown, splitStepTimers } from '../../shared/step-timers'
import { useWakeLock } from '../hooks/useWakeLock'
import { fireTimerAlert, primeTimerAlerts } from '../lib/timerAlert'
import { BottomSheet } from './BottomSheet'
import { ConfirmSheet } from './ConfirmSheet'

/** A running, paused or finished countdown. Running timers hold their END time, not a
 *  remaining count, so a throttled background tab can't make them drift. */
interface CookTimer {
  id: number
  /** "Step 3 · 25 min" — which step it came from, for the tray and the alarm. */
  label: string
  /** step index + matched phrase, so the step's pill can show its own countdown */
  key: string
  endsAt: number | null
  /** seconds left while paused */
  pausedLeft: number | null
  done: boolean
}

const SWIPE_PX = 50

/** Wall-clock ms, for the tick and tap handlers (never read during render). */
const nowMs = (): number => Date.now()

/** Fullscreen blue cooking field: giant step numeral, one step at a time, with
 *  tap-to-start timers from the step text, the step's ingredients, and the screen kept on. */
export function CookingMode(props: {
  recipe: Recipe
  /** Serving scale from the detail page, so amounts match what the cook chose. */
  factor: number
  onClose: () => void
}): JSX.Element {
  const { recipe, factor, onClose } = props
  const [current, setCurrent] = useState(0)
  const [timers, setTimers] = useState<CookTimer[]>([])
  const [now, setNow] = useState(nowMs)
  const [showIngredients, setShowIngredients] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(() => new Set())
  const [confirmLeave, setConfirmLeave] = useState(false)
  const nextId = useRef(1)
  const touchX = useRef<number | null>(null)
  const rung = useRef<Set<number>>(new Set())
  useWakeLock()

  const steps = recipe.steps
  const isLast = current === steps.length - 1
  const step = steps[current]
  const parts = useMemo(() => splitStepTimers(step.text), [step.text])
  const stepIngredients = useMemo(
    () => ingredientsForStep(step.text, recipe.ingredients),
    [step.text, recipe.ingredients]
  )
  const running = timers.filter((t) => !t.done)

  // Tick while anything is counting down; finished timers ring once, from here.
  useEffect(() => {
    if (!timers.some((t) => t.endsAt !== null && !t.done)) return
    const tick = (): void => {
      const t = nowMs()
      setNow(t)
      // `rung` keeps a timer from ringing twice if a tick lands before the re-render.
      const finished = timers.filter(
        (x) => !x.done && x.endsAt !== null && x.endsAt <= t && !rung.current.has(x.id)
      )
      if (finished.length === 0) return
      for (const f of finished) {
        rung.current.add(f.id)
        fireTimerAlert(`${f.label} — done`, recipe.title)
      }
      const ids = new Set(finished.map((f) => f.id))
      setTimers((cur) => cur.map((x) => (ids.has(x.id) ? { ...x, done: true, endsAt: null } : x)))
    }
    const interval = window.setInterval(tick, 250)
    // Coming back from the background: catch up at once instead of on the next tick.
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [timers, recipe.title])

  const go = (delta: -1 | 1): void =>
    setCurrent((c) => Math.min(Math.max(c + delta, 0), steps.length - 1))

  const leave = (): void => {
    if (running.length > 0) setConfirmLeave(true)
    else onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (showIngredients || confirmLeave) return // the sheet owns the keyboard
      if (e.key === 'Escape') leave()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const startTimer = (key: string, seconds: number, label: string): void => {
    primeTimerAlerts() // this tap is what lets the alarm make a sound later
    const t = nowMs()
    setNow(t)
    setTimers((cur) => [
      ...cur,
      {
        id: nextId.current++,
        label: `Step ${current + 1} · ${label}`,
        key,
        endsAt: t + seconds * 1000,
        pausedLeft: null,
        done: false
      }
    ])
  }

  const togglePause = (id: number): void => {
    const t = nowMs()
    setNow(t)
    setTimers((cur) =>
      cur.map((x) => {
        if (x.id !== id || x.done) return x
        if (x.endsAt !== null) return { ...x, endsAt: null, pausedLeft: (x.endsAt - t) / 1000 }
        return { ...x, endsAt: t + (x.pausedLeft ?? 0) * 1000, pausedLeft: null }
      })
    )
  }

  const removeTimer = (id: number): void => setTimers((cur) => cur.filter((x) => x.id !== id))

  const secondsLeft = (t: CookTimer): number =>
    t.endsAt !== null ? (t.endsAt - now) / 1000 : (t.pausedLeft ?? 0)

  const toggleChecked = (position: number): void =>
    setChecked((cur) => {
      const next = new Set(cur)
      if (next.has(position)) next.delete(position)
      else next.add(position)
      return next
    })

  const onTouchStart = (e: TouchEvent): void => {
    touchX.current = e.touches[0]?.clientX ?? null
  }
  const onTouchEnd = (e: TouchEvent): void => {
    if (touchX.current === null) return
    const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current
    touchX.current = null
    if (Math.abs(dx) < SWIPE_PX) return
    go(dx < 0 ? 1 : -1)
  }

  return (
    <div className="cooking">
      <div className="cooking__top">
        <span className="cooking__recipe">{recipe.title}</span>
        <button className="cooking__close" aria-label="Exit cooking mode" onClick={leave}>
          <X size={18} strokeWidth={2.4} />
        </button>
      </div>

      {timers.length > 0 && (
        <div className="cooking__timers" aria-live="polite">
          {timers.map((t) => (
            <div
              key={t.id}
              className={`cooking__timer ${t.done ? 'cooking__timer--done' : ''} ${
                t.endsAt === null && !t.done ? 'cooking__timer--paused' : ''
              }`}
            >
              <button
                className="cooking__timer-main"
                onClick={() => (t.done ? removeTimer(t.id) : togglePause(t.id))}
                aria-label={
                  t.done ? `${t.label} done — dismiss` : t.endsAt === null ? 'Resume' : 'Pause'
                }
              >
                {t.done ? (
                  <Check size={14} strokeWidth={3} />
                ) : t.endsAt === null ? (
                  <Play size={14} strokeWidth={2.6} />
                ) : (
                  <Pause size={14} strokeWidth={2.6} />
                )}
                <span className="cooking__timer-label">{t.label}</span>
                <span className="cooking__timer-time">
                  {t.done ? 'Done' : formatCountdown(secondsLeft(t))}
                </span>
              </button>
              {!t.done && (
                <button
                  className="cooking__timer-x"
                  aria-label={`Cancel ${t.label}`}
                  onClick={() => removeTimer(t.id)}
                >
                  <X size={13} strokeWidth={2.6} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="cooking__center" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="cooking__num">{String(current + 1).padStart(2, '0')}</div>
        <div className="cooking__text">
          {step.section ? <span className="cooking__section">{step.section} — </span> : null}
          {parts.map((p, i) => {
            if (p.kind === 'text') return <span key={i}>{p.text}</span>
            const key = `${current}:${i}`
            const live = timers.find((t) => t.key === key && !t.done)
            return (
              <button
                key={i}
                className={`cooking__timer-btn ${live ? 'cooking__timer-btn--live' : ''}`}
                onClick={() => (live ? togglePause(live.id) : startTimer(key, p.seconds, p.label))}
                aria-label={live ? `Timer running, ${p.label}` : `Start a ${p.label} timer`}
              >
                <Timer size={18} strokeWidth={2.6} />
                {live ? formatCountdown(secondsLeft(live)) : p.text}
              </button>
            )
          })}
        </div>

        {stepIngredients.length > 0 && (
          <div className="cooking__uses">
            <span className="cooking__uses-label">In this step</span>
            <div className="cooking__uses-list">
              {stepIngredients.map((ing) => (
                <span key={ing.position} className="cooking__use">
                  {formatScaledIngredient(ing, factor)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="cooking__footer">
        <button
          className="cooking__back cooking__ingredients-btn"
          aria-label="All ingredients"
          onClick={() => setShowIngredients(true)}
        >
          <ListChecks size={18} strokeWidth={2.4} />
        </button>
        <span className="cooking__progress">
          Step {current + 1} of {steps.length}
        </span>
        <button
          className="cooking__back"
          style={current === 0 ? { opacity: 0.4 } : undefined}
          disabled={current === 0}
          onClick={() => go(-1)}
        >
          Back
        </button>
        <button className="cooking__next" onClick={() => (isLast ? leave() : go(1))}>
          {isLast ? 'Done' : 'Next'}
        </button>
      </div>

      {/* Sheets render inside the cooking layer so they stack above it. */}
      {showIngredients && (
        <BottomSheet title="Ingredients" onClose={() => setShowIngredients(false)}>
          <div className="cooking-list">
            {recipe.ingredients.map((ing) => {
              const on = checked.has(ing.position)
              return (
                <button
                  key={ing.position}
                  className={`cooking-list__row ${on ? 'cooking-list__row--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleChecked(ing.position)}
                >
                  <span className="cooking-list__tick">
                    {on && <Check size={13} strokeWidth={3} />}
                  </span>
                  {formatScaledIngredient(ing, factor)}
                </button>
              )
            })}
          </div>
        </BottomSheet>
      )}
      {confirmLeave && (
        <ConfirmSheet
          title="Leave cooking mode?"
          body={`${running.length === 1 ? 'Your timer' : `Your ${running.length} timers`} will stop.`}
          confirmLabel="Stop and leave"
          onConfirm={onClose}
          onClose={() => setConfirmLeave(false)}
        />
      )}
    </div>
  )
}
