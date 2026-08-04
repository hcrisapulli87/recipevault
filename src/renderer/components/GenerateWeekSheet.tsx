import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Lock, Pencil, Shuffle, Unlock } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { RecipePicker } from './RecipePicker'
import { generateWeek, setCookSlot } from '../../shared/plan-generator'
import type { LeftoverAppetite } from '../../shared/plan-generator'
import { DEFAULT_PLAN_PREFS } from '../../shared/plan-prefs'
import type { PlanPrefs } from '../../shared/plan-prefs'
import { getPlanPrefs, savePlanPrefs } from '../data/planPrefs'
import {
  CUISINES,
  CUISINE_LABEL,
  DIET_TAGS,
  DIET_LABEL,
  DAY_SHORT,
  MEAL_LABEL,
  PLAN_MEALS
} from '../../shared/types'
import type { Day, MealPlanEntry, PlanMeal, RecipeSummary } from '../../shared/types'

const APPETITES: { value: LeftoverAppetite; label: string; hint: string }[] = [
  { value: 'low', label: 'Few', hint: 'one extra meal per batch' },
  { value: 'medium', label: 'Some', hint: 'up to two extra meals' },
  { value: 'high', label: 'Lots', hint: 'up to three extra meals' }
]

type StepId = 'meals' | 'diet' | 'cuisines' | 'effort' | 'leftovers' | 'review'
const STEPS: StepId[] = ['meals', 'diet', 'cuisines', 'effort', 'leftovers', 'review']

const slotKey = (e: { day: string; meal: string }): string => `${e.day}|${e.meal}`
const isPlanned = (e: MealPlanEntry): boolean => e.recipeId !== null || e.freeText !== null
const randomSeed = (): number => Math.floor(Math.random() * 1e9)

function Stepper(props: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="gen-row">
      <span className="gen-row__label">{props.label}</span>
      <div className="stepper">
        <button
          className="stepper__btn"
          aria-label={`Fewer ${props.label}`}
          disabled={props.value <= props.min}
          onClick={() => props.onChange(props.value - 1)}
        >
          −
        </button>
        <span className="stepper__value">{props.value}</span>
        <button
          className="stepper__btn"
          aria-label={`More ${props.label}`}
          disabled={props.value >= props.max}
          onClick={() => props.onChange(props.value + 1)}
        >
          +
        </button>
      </div>
    </div>
  )
}

/**
 * The "Generate week" wizard: one question per screen, ending in a review of the week it
 * built. Nothing is written until Apply on that last screen.
 *
 * The review step is the point of the whole flow. A generated week is a suggestion, and a
 * suggestion you can only accept or reroll wholesale is useless the moment you like four
 * nights out of five — so every slot can be locked (survives every later shuffle),
 * rerolled on its own, or replaced by hand.
 *
 * Answers are remembered on the profile, so the second week opens on the review step with
 * last week's settings already applied.
 */
export function GenerateWeekSheet(props: {
  recipes: RecipeSummary[]
  /** Slots already filled, offered as pinnable so a generated week can work around them. */
  existing: MealPlanEntry[]
  onClose: () => void
  onApply: (week: MealPlanEntry[]) => Promise<void>
}): JSX.Element {
  const { recipes } = props
  const [prefs, setPrefs] = useState<PlanPrefs>(DEFAULT_PLAN_PREFS)
  const [stepIdx, setStepIdx] = useState(0)
  const [keepExisting, setKeepExisting] = useState(true)
  const [seed, setSeed] = useState(randomSeed)
  /** Slots the user pinned or hand-picked. Held as entries, not keys, so a pinned slot
   *  keeps its exact contents through every regeneration. */
  const [pins, setPins] = useState<Map<string, MealPlanEntry>>(new Map())
  const [picking, setPicking] = useState<{ day: Day; meal: PlanMeal } | null>(null)
  const [applying, setApplying] = useState(false)

  const filled = useMemo(() => props.existing.filter(isPlanned), [props.existing])

  /**
   * Regenerate the whole week. Every input is passed in rather than read from state, so a
   * handler can build the week that its own `setState` is about to produce instead of
   * waiting a render for it — which is what keeps the preview out of an effect.
   */
  const build = useCallback(
    (o: {
      prefs: PlanPrefs
      pins: Map<string, MealPlanEntry>
      seed: number
      keepExisting: boolean
    }): MealPlanEntry[] =>
      generateWeek(recipes, {
        ...o.prefs,
        locked: [...(o.keepExisting ? filled : []), ...o.pins.values()],
        seed: o.seed
      }),
    [recipes, filled]
  )

  const [week, setWeek] = useState<MealPlanEntry[]>(() =>
    generateWeek(recipes, { ...DEFAULT_PLAN_PREFS, locked: [], seed })
  )

  // A returning user has already answered every question — drop them on the review step
  // rather than making them walk the wizard again to get the same week. A first-timer
  // (null, not defaults) still gets asked. Landing in a `.then` rather than the effect
  // body, this is a response to an external system, not a render-time derivation.
  useEffect(() => {
    let live = true
    getPlanPrefs()
      .then((stored) => {
        if (!live || stored === null) return
        setPrefs(stored)
        setWeek(build({ prefs: stored, pins: new Map(), seed, keepExisting: true }))
        setStepIdx(STEPS.length - 1)
      })
      .catch(() => {
        /* No stored answers (or offline) — start at question one with the defaults. */
      })
    return () => {
      live = false
    }
    // Mount only: this restores last week's answers, it doesn't track later edits to them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const titleOf = (id: number | null): string | null =>
    id === null ? null : (props.recipes.find((r) => r.id === id)?.title ?? null)

  const planned = week.filter(isPlanned)
  const cookCount = planned.filter((e) => !e.isLeftover && e.recipeId !== null).length
  const leftoverCount = planned.filter((e) => e.isLeftover).length

  const toggle = <T,>(list: T[], value: T, set: (v: T[]) => void): void =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  /** Answer a question: store it and rebuild the preview off the new answer. */
  const patch = (p: Partial<PlanPrefs>): void => {
    const next = { ...prefs, ...p }
    setPrefs(next)
    setWeek(build({ prefs: next, pins, seed, keepExisting }))
  }

  const setKeep = (keep: boolean): void => {
    setKeepExisting(keep)
    setWeek(build({ prefs, pins, seed, keepExisting: keep }))
  }

  const shuffleAll = (): void => {
    const nextSeed = randomSeed()
    setSeed(nextSeed)
    setWeek(build({ prefs, pins, seed: nextSeed, keepExisting }))
  }

  // ── review-step actions ─────────────────────────────────────────────────────
  const togglePin = (entry: MealPlanEntry): void => {
    const next = new Map(pins)
    if (next.has(slotKey(entry))) next.delete(slotKey(entry))
    else next.set(slotKey(entry), entry)
    setPins(next)
  }

  /**
   * Reroll one slot. Everything else on screen is frozen as a pin for this one
   * regeneration, so the generator has exactly one hole to fill.
   *
   * The slot's leftover children are deliberately left unfrozen: they carry the cook
   * night's recipe id, so freezing them would leave you eating leftovers of a dish that is
   * no longer cooked. Unfrozen, the generator re-chains them onto whatever it picks, or
   * leaves them empty when the new dish can't be chained at all.
   */
  const reshuffleSlot = (entry: MealPlanEntry): void => {
    const targetKey = slotKey(entry)
    const childKeys = new Set(
      week
        .filter(
          (e) =>
            e.isLeftover &&
            e.cookDay === entry.day &&
            e.recipeId === entry.recipeId &&
            slotKey(e) !== targetKey
        )
        .map(slotKey)
    )
    const frozen = new Map(pins)
    for (const e of week) {
      const key = slotKey(e)
      if (key === targetKey || childKeys.has(key) || !isPlanned(e)) continue
      frozen.set(key, e)
    }
    // A local seed, not the sheet's: `seed` is what a later "Shuffle all" rerolls from,
    // and this freeze applies to one slot on one call.
    setWeek(build({ prefs, pins: frozen, seed: randomSeed(), keepExisting }))
    // The freeze applied to this call alone. Any pin on the rerolled slot's children is
    // dropped though — it pointed at a batch that may no longer be cooked.
    if (childKeys.size > 0) {
      const keptPins = new Map(pins)
      for (const key of childKeys) keptPins.delete(key)
      setPins(keptPins)
    }
  }

  const pickRecipe = (recipe: RecipeSummary): void => {
    if (!picking) return
    const next = setCookSlot(
      week,
      { day: picking.day as MealPlanEntry['day'], meal: picking.meal },
      recipe,
      prefs.servingsPerMeal
    )
    setWeek(next)
    // A hand-picked slot is a decision, so it pins itself — a later shuffle won't undo it.
    const nextPins = new Map(pins)
    const chosen = next.find((e) => slotKey(e) === slotKey(picking))
    if (chosen) nextPins.set(slotKey(picking), chosen)
    setPins(nextPins)
    setPicking(null)
  }

  const apply = async (): Promise<void> => {
    setApplying(true)
    try {
      await savePlanPrefs(prefs).catch(() => {
        /* Remembering the answers is a convenience; never block applying the week on it. */
      })
      await props.onApply(week)
    } finally {
      setApplying(false)
    }
  }

  // ── steps ───────────────────────────────────────────────────────────────────
  const step = STEPS[stepIdx]
  const isReview = step === 'review'

  // Only cuisines the catalog can actually satisfy for a cook night — offering "Spanish"
  // when there are no batch-friendly Spanish dinners produces an empty-looking week.
  const availableCuisines = useMemo(
    () =>
      CUISINES.filter((c) =>
        props.recipes.some(
          (r) => r.cuisine === c && r.batchFriendly && r.mealSlots.includes('dinner')
        )
      ),
    [props.recipes]
  )

  const stepBody = (): JSX.Element => {
    switch (step) {
      case 'meals':
        return (
          <div className="gen-step">
            <h3 className="gen-step__q">Which meals should it plan?</h3>
            <div className="chip-row">
              {PLAN_MEALS.map((m) => (
                <button
                  key={m}
                  className={`filter-chip ${prefs.slots.includes(m) ? 'filter-chip--on' : ''}`}
                  onClick={() => toggle(prefs.slots, m, (slots) => patch({ slots }))}
                >
                  {MEAL_LABEL[m]}
                </button>
              ))}
            </div>
            <p className="gen-hint">Anything you leave out stays exactly as it is.</p>
          </div>
        )
      case 'diet':
        return (
          <div className="gen-step">
            <h3 className="gen-step__q">Any diets to stick to?</h3>
            <div className="chip-row">
              {DIET_TAGS.map((d) => (
                <button
                  key={d}
                  className={`filter-chip ${prefs.diets.includes(d) ? 'filter-chip--on' : ''}`}
                  onClick={() => toggle(prefs.diets, d, (diets) => patch({ diets }))}
                >
                  {DIET_LABEL[d]}
                </button>
              ))}
            </div>
            <p className="gen-hint">No diet selected means anything goes.</p>
          </div>
        )
      case 'cuisines':
        return (
          <div className="gen-step">
            <h3 className="gen-step__q">What do you feel like eating?</h3>
            <div className="chip-row">
              {availableCuisines.map((c) => (
                <button
                  key={c}
                  className={`filter-chip ${prefs.cuisines.includes(c) ? 'filter-chip--on' : ''}`}
                  onClick={() => toggle(prefs.cuisines, c, (cuisines) => patch({ cuisines }))}
                >
                  {CUISINE_LABEL[c]}
                </button>
              ))}
            </div>
            <p className="gen-hint">
              Applies to cook nights. Breakfasts and lunches ignore it — porridge belongs to
              no cuisine.
            </p>
          </div>
        )
      case 'effort':
        return (
          <div className="gen-step">
            <h3 className="gen-step__q">How much cooking?</h3>
            <Stepper
              label="Cook nights"
              value={prefs.cookNights}
              min={1}
              max={7}
              onChange={(cookNights) => patch({ cookNights })}
            />
            <Stepper
              label="Serves per meal"
              value={prefs.servingsPerMeal}
              min={1}
              max={8}
              onChange={(servingsPerMeal) => patch({ servingsPerMeal })}
            />
            <p className="gen-hint">
              The other nights are filled from those batches. Serves per meal is what the
              grocery list buys for.
            </p>
          </div>
        )
      case 'leftovers':
        return (
          <div className="gen-step">
            <h3 className="gen-step__q">How do you feel about leftovers?</h3>
            <div className="chip-row">
              {APPETITES.map((a) => (
                <button
                  key={a.value}
                  className={`filter-chip ${
                    prefs.leftoverAppetite === a.value ? 'filter-chip--on' : ''
                  }`}
                  onClick={() => patch({ leftoverAppetite: a.value })}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="gen-hint">
              {APPETITES.find((a) => a.value === prefs.leftoverAppetite)!.hint}.
            </p>
            {filled.length > 0 && (
              <label className="gen-check">
                <input
                  type="checkbox"
                  checked={keepExisting}
                  onChange={(e) => setKeep(e.target.checked)}
                />
                <span>
                  Keep the {filled.length} slot{filled.length === 1 ? '' : 's'} already planned
                </span>
              </label>
            )}
          </div>
        )
      case 'review':
        return (
          <div className="gen-step">
            <div className="gen-review__head">
              <h3 className="gen-step__q gen-step__q--tight">Here&rsquo;s the week</h3>
              <span className="gen-preview__stats">
                {cookCount} to cook · {leftoverCount} leftover
              </span>
            </div>
            {planned.length === 0 ? (
              <p className="gen-hint">
                Nothing matched those answers. Step back and loosen the diet or cuisine
                choices.
              </p>
            ) : (
              <>
                <p className="gen-hint gen-review__hint">
                  Lock what you like, reshuffle what you don&rsquo;t, or pick a slot yourself.
                </p>
                <ul className="gen-review__list">
                  {planned.map((e) => {
                    const pinned = pins.has(slotKey(e))
                    return (
                      <li
                        key={slotKey(e)}
                        className={`gen-review__row ${e.isLeftover ? 'gen-review__row--left' : ''} ${
                          pinned ? 'gen-review__row--pinned' : ''
                        }`}
                      >
                        <span className="gen-preview__slot">
                          {DAY_SHORT[e.day]} {MEAL_LABEL[e.meal].charAt(0)}
                        </span>
                        <span className="gen-review__title">
                          {e.isLeftover && e.cookDay ? 'Leftovers · ' : ''}
                          {e.freeText ?? titleOf(e.recipeId) ?? '—'}
                        </span>
                        <button
                          className={`gen-review__btn ${pinned ? 'gen-review__btn--on' : ''}`}
                          aria-label={pinned ? 'Unlock this meal' : 'Lock this meal'}
                          aria-pressed={pinned}
                          onClick={() => togglePin(e)}
                        >
                          {pinned ? <Lock size={15} /> : <Unlock size={15} />}
                        </button>
                        <button
                          className="gen-review__btn"
                          aria-label="Reshuffle this meal"
                          disabled={pinned}
                          onClick={() => reshuffleSlot(e)}
                        >
                          <Shuffle size={15} />
                        </button>
                        <button
                          className="gen-review__btn"
                          aria-label="Pick this meal myself"
                          onClick={() => setPicking({ day: e.day, meal: e.meal })}
                        >
                          <Pencil size={15} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        )
    }
  }

  const footer = isReview ? (
    <div className="gen-actions">
      <button className="btn-ghost" onClick={() => setStepIdx(stepIdx - 1)}>
        Back
      </button>
      <button className="btn-secondary" onClick={shuffleAll}>
        Shuffle all
      </button>
      <button
        className="btn-primary"
        disabled={planned.length === 0 || applying}
        onClick={apply}
      >
        {applying ? 'Applying…' : 'Apply to week'}
      </button>
    </div>
  ) : (
    <div className="gen-actions">
      <button className="btn-ghost" disabled={stepIdx === 0} onClick={() => setStepIdx(stepIdx - 1)}>
        Back
      </button>
      <button
        className="btn-primary"
        disabled={step === 'meals' && prefs.slots.length === 0}
        onClick={() => setStepIdx(stepIdx + 1)}
      >
        {stepIdx === STEPS.length - 2 ? 'See the week' : 'Next'}
      </button>
    </div>
  )

  // The picker takes over the sheet rather than stacking a second one — two glass sheets
  // deep on a phone leaves nowhere to tap to get out.
  if (picking) {
    const slot = week.find((e) => slotKey(e) === slotKey(picking))
    return (
      <BottomSheet
        title={`${DAY_SHORT[picking.day as MealPlanEntry['day']]} · ${MEAL_LABEL[picking.meal]}`}
        tall
        onClose={() => setPicking(null)}
        footer={
          <button className="btn-secondary gen-pick__back" onClick={() => setPicking(null)}>
            Back to the week
          </button>
        }
      >
        {slot?.isLeftover && (
          <p className="plan-edit__note">
            This slot is currently leftovers. Picking a recipe makes it a cook night of its
            own.
          </p>
        )}
        <RecipePicker recipes={props.recipes} meal={picking.meal} onPick={pickRecipe} />
      </BottomSheet>
    )
  }

  return (
    <BottomSheet title="Generate week" tall onClose={props.onClose} footer={footer}>
      <div className="gen">
        <div className="gen-progress" aria-label={`Step ${stepIdx + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={`gen-progress__dot ${i <= stepIdx ? 'gen-progress__dot--on' : ''}`}
            />
          ))}
          <span className="gen-progress__count">
            {stepIdx + 1}/{STEPS.length}
          </span>
        </div>
        {stepBody()}
      </div>
    </BottomSheet>
  )
}
