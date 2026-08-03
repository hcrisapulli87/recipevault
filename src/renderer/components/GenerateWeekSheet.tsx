import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { BottomSheet } from './BottomSheet'
import { generateWeek, DEFAULT_GENERATE_OPTIONS } from '../../shared/plan-generator'
import type { LeftoverAppetite } from '../../shared/plan-generator'
import {
  CUISINES,
  CUISINE_LABEL,
  DIET_TAGS,
  DIET_LABEL,
  DAY_SHORT,
  MEAL_LABEL,
  PLAN_MEALS
} from '../../shared/types'
import type { Cuisine, DietTag, MealPlanEntry, PlanMeal, RecipeSummary } from '../../shared/types'

const APPETITES: { value: LeftoverAppetite; label: string; hint: string }[] = [
  { value: 'low', label: 'Few', hint: 'one extra meal per batch' },
  { value: 'medium', label: 'Some', hint: 'up to two extra meals' },
  { value: 'high', label: 'Lots', hint: 'up to three extra meals' }
]

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
 * The "Generate week" sheet. The plan is shared between two people, so a generated week is
 * previewed here and only written when the user confirms — nothing is ever silently
 * overwritten under the other person.
 */
export function GenerateWeekSheet(props: {
  recipes: RecipeSummary[]
  /** Slots already filled, offered as pinnable so a generated week can work around them. */
  existing: MealPlanEntry[]
  onClose: () => void
  onApply: (week: MealPlanEntry[]) => Promise<void>
}): JSX.Element {
  const [diets, setDiets] = useState<DietTag[]>([])
  const [cuisines, setCuisines] = useState<Cuisine[]>([])
  const [cookNights, setCookNights] = useState(DEFAULT_GENERATE_OPTIONS.cookNights)
  const [servings, setServings] = useState(DEFAULT_GENERATE_OPTIONS.servingsPerMeal)
  const [appetite, setAppetite] = useState<LeftoverAppetite>('medium')
  const [slots, setSlots] = useState<PlanMeal[]>([...PLAN_MEALS])
  const [keepExisting, setKeepExisting] = useState(true)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [applying, setApplying] = useState(false)

  const filled = useMemo(
    () => props.existing.filter((e) => e.recipeId !== null || e.freeText !== null),
    [props.existing]
  )

  // Only cuisines the catalog can actually satisfy for a cook night — offering "Spanish"
  // when there are no batch-friendly Spanish dinners produces an empty-looking week.
  const availableCuisines = useMemo(
    () =>
      CUISINES.filter((c) =>
        props.recipes.some((r) => r.cuisine === c && r.batchFriendly && r.mealSlots.includes('dinner'))
      ),
    [props.recipes]
  )

  const week = useMemo(
    () =>
      generateWeek(props.recipes, {
        diets,
        cuisines,
        cookNights,
        servingsPerMeal: servings,
        leftoverAppetite: appetite,
        slots,
        locked: keepExisting ? filled : [],
        seed
      }),
    [props.recipes, diets, cuisines, cookNights, servings, appetite, slots, keepExisting, filled, seed]
  )

  const titleOf = (id: number | null): string | null =>
    id === null ? null : (props.recipes.find((r) => r.id === id)?.title ?? null)

  const planned = week.filter((e) => e.recipeId !== null || e.freeText !== null)
  const cookCount = planned.filter((e) => !e.isLeftover && e.recipeId !== null).length
  const leftoverCount = planned.filter((e) => e.isLeftover).length

  const toggle = <T,>(list: T[], value: T, set: (v: T[]) => void): void =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  const apply = async (): Promise<void> => {
    setApplying(true)
    try {
      await props.onApply(week)
    } finally {
      setApplying(false)
    }
  }

  return (
    <BottomSheet title="Generate week" tall onClose={props.onClose}>
      <div className="gen">
        <div className="gen-section">
          <div className="eyebrow">Diet</div>
          <div className="chip-row">
            {DIET_TAGS.map((d) => (
              <button
                key={d}
                className={`filter-chip ${diets.includes(d) ? 'filter-chip--on' : ''}`}
                onClick={() => toggle(diets, d, setDiets)}
              >
                {DIET_LABEL[d]}
              </button>
            ))}
          </div>
          <p className="gen-hint">No diet selected means anything goes.</p>
        </div>

        <div className="gen-section">
          <div className="eyebrow">Cuisines</div>
          <div className="chip-row">
            {availableCuisines.map((c) => (
              <button
                key={c}
                className={`filter-chip ${cuisines.includes(c) ? 'filter-chip--on' : ''}`}
                onClick={() => toggle(cuisines, c, setCuisines)}
              >
                {CUISINE_LABEL[c]}
              </button>
            ))}
          </div>
          <p className="gen-hint">Applies to cook nights. Breakfasts and lunches ignore it.</p>
        </div>

        <div className="gen-section">
          <Stepper
            label="Cook nights"
            value={cookNights}
            min={1}
            max={7}
            onChange={setCookNights}
          />
          <Stepper label="Serves per meal" value={servings} min={1} max={8} onChange={setServings} />
        </div>

        <div className="gen-section">
          <div className="eyebrow">Leftovers</div>
          <div className="chip-row">
            {APPETITES.map((a) => (
              <button
                key={a.value}
                className={`filter-chip ${appetite === a.value ? 'filter-chip--on' : ''}`}
                onClick={() => setAppetite(a.value)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="gen-hint">{APPETITES.find((a) => a.value === appetite)!.hint}.</p>
        </div>

        <div className="gen-section">
          <div className="eyebrow">Fill which meals</div>
          <div className="chip-row">
            {PLAN_MEALS.map((m) => (
              <button
                key={m}
                className={`filter-chip ${slots.includes(m) ? 'filter-chip--on' : ''}`}
                onClick={() => toggle(slots, m, setSlots)}
              >
                {MEAL_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {filled.length > 0 && (
          <label className="gen-check">
            <input
              type="checkbox"
              checked={keepExisting}
              onChange={(e) => setKeepExisting(e.target.checked)}
            />
            <span>
              Keep the {filled.length} slot{filled.length === 1 ? '' : 's'} already planned
            </span>
          </label>
        )}

        <div className="gen-preview">
          <div className="gen-preview__head">
            <span className="eyebrow">Preview</span>
            <span className="gen-preview__stats">
              {cookCount} to cook · {leftoverCount} leftover
            </span>
          </div>
          {planned.length === 0 ? (
            <p className="gen-hint">
              Nothing matched those filters. Loosen the diet or cuisine choices.
            </p>
          ) : (
            <ul className="gen-preview__list">
              {planned.map((e) => (
                <li key={`${e.day}|${e.meal}`} className={e.isLeftover ? 'gen-preview--left' : ''}>
                  <span className="gen-preview__slot">
                    {DAY_SHORT[e.day]} {MEAL_LABEL[e.meal].charAt(0)}
                  </span>
                  <span className="gen-preview__title">
                    {e.isLeftover && e.cookDay ? `Leftovers · ` : ''}
                    {e.freeText ?? titleOf(e.recipeId) ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="gen-actions">
          <button className="btn-ghost" onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>
            Shuffle
          </button>
          <button
            className="btn-primary"
            disabled={planned.length === 0 || applying}
            onClick={apply}
          >
            {applying ? 'Applying…' : 'Apply to week'}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
