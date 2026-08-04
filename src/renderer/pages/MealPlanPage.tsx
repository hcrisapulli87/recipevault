import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Sparkles, Utensils } from 'lucide-react'
import { DAY_SHORT, DAYS, MEAL_LABEL, PLAN_MEALS } from '../../shared/types'
import type { Day, FoodItem, MealPlanEntry, MealType, PlanMeal, RecipeSummary } from '../../shared/types'
import { planLabel } from '../../shared/plan-generator'
import { planSlotToFood } from '../../shared/plan-to-food'
import { BottomSheet } from '../components/BottomSheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { GroceryPreviewModal } from '../components/GroceryPreviewModal'
import { GenerateWeekSheet } from '../components/GenerateWeekSheet'
import { PersonSwitcher } from '../components/PersonSwitcher'
import { RecipePicker } from '../components/RecipePicker'
import { getMealPlan, setMeal, clearWeek, applyGeneratedWeek } from '../data/mealPlan'
import { onTableChange } from '../data/realtime'
import type { HouseholdUser } from '../data/users'

const SLOT_KEY: Record<PlanMeal, string> = { breakfast: 'B', lunch: 'L', dinner: 'D' }

/** Date of this week's Monday (week starts Monday). */
function mondayOfThisWeek(): Date {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
const dayNum = (d: Date): number => d.getDate()
const monthShort = (d: Date): string => d.toLocaleDateString(undefined, { month: 'short' })

export function MealPlanPage(props: {
  recipes: RecipeSummary[]
  users: HouseholdUser[]
  current: HouseholdUser | null
  readOnly: boolean
  onSelectViewer: (user: HouseholdUser) => void
  onOpenRecipe: (id: number) => void
  onLogToTracker: (meal: MealType, planned: FoodItem) => void
}): JSX.Element {
  const { users, current, readOnly } = props
  const [plan, setPlan] = useState<MealPlanEntry[]>([])
  const [groceryOpen, setGroceryOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [editing, setEditing] = useState<{ day: Day; meal: PlanMeal } | null>(null)
  const [freeText, setFreeText] = useState('')

  // Each person plans their own week; the switcher shows the other's read-only.
  // Realtime keeps a phone and the desktop app in sync on the same week.
  const reload = useCallback(() => {
    if (!current) return
    getMealPlan(current.id).then(setPlan)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  useEffect(() => {
    reload()
    return onTableChange(['meal_plan'], reload)
  }, [reload])

  const recipeById = useMemo(
    () => new Map(props.recipes.map((r) => [r.id, r])),
    [props.recipes]
  )
  const slotFor = (day: Day, meal: PlanMeal): MealPlanEntry | undefined =>
    plan.find((e) => e.day === day && e.meal === meal)

  /** Every write goes through here so `meal_text` — the label the Discord bot reads —
   *  is always set, including on leftover slots. */
  const writeSlot = async (entry: MealPlanEntry): Promise<void> => {
    const title = entry.recipeId !== null ? (recipeById.get(entry.recipeId)?.title ?? null) : null
    await setMeal({
      day: entry.day,
      meal: entry.meal,
      recipeId: entry.recipeId,
      freeText: entry.freeText,
      mealText: planLabel(entry, title),
      isLeftover: entry.isLeftover,
      cookDay: entry.cookDay,
      servingsPlanned: entry.servingsPlanned
    })
    setEditing(null)
    setFreeText('')
    reload()
  }

  const setSlot = (
    day: Day,
    meal: PlanMeal,
    recipeId: number | null,
    text: string | null,
    extra: Partial<MealPlanEntry> = {}
  ): Promise<void> =>
    writeSlot({
      day,
      meal,
      recipeId,
      freeText: text,
      isLeftover: false,
      cookDay: null,
      servingsPlanned: recipeId !== null ? 2 : null,
      ...extra
    })

  const clearAll = async (): Promise<void> => {
    await clearWeek()
    reload()
  }

  const applyWeek = async (week: MealPlanEntry[]): Promise<void> => {
    await applyGeneratedWeek(week, (e) =>
      planLabel(e, e.recipeId !== null ? (recipeById.get(e.recipeId)?.title ?? null) : null)
    )
    setGenerateOpen(false)
    reload()
  }

  // ── week summary ──────────────────────────────────────────────────────────
  const filledSlots = plan.filter((e) => e.recipeId !== null || e.freeText !== null)
  const cookSlots = plan.filter((e) => e.recipeId !== null && !e.isLeftover)
  const distinctRecipes = new Set(
    plan.filter((e) => e.recipeId !== null).map((e) => e.recipeId as number)
  ).size

  /** Average planned kcal per day, per person. A best guess built from best guesses, so
   *  it's labelled as one and only shown once there is enough of a week to mean anything. */
  const avgKcal = useMemo(() => {
    const withEst = plan.filter((e) => e.recipeId !== null && recipeById.get(e.recipeId!)?.est)
    if (withEst.length < 3) return null
    const daysPlanned = new Set(withEst.map((e) => e.day)).size
    const total = withEst.reduce(
      (sum, e) => sum + (recipeById.get(e.recipeId!)!.est!.calories ?? 0),
      0
    )
    return Math.round(total / daysPlanned)
  }, [plan, recipeById])

  // ── suggestions ───────────────────────────────────────────────────────────
  /** Three catalog recipes that fit the emptiest slot, so the strip answers the question
   *  the page is actually posing ("what goes in that gap?") rather than showing a
   *  general-purpose carousel. */
  const suggestion = useMemo(() => {
    const emptyByMeal = PLAN_MEALS.map((meal) => ({
      meal,
      empty: DAYS.filter((day) => {
        const s = plan.find((e) => e.day === day && e.meal === meal)
        return !s || (s.recipeId === null && s.freeText === null)
      })
    })).sort((a, b) => b.empty.length - a.empty.length)

    const target = emptyByMeal[0]
    if (!target || target.empty.length === 0) return null

    const planned = new Set(plan.map((e) => e.recipeId).filter(Boolean))
    const options = props.recipes
      .filter((r) => r.isCatalog && r.mealSlots.includes(target.meal) && !planned.has(r.id))
      .slice(0, 3)
    if (options.length === 0) return null
    return { meal: target.meal, day: target.empty[0], options }
  }, [plan, props.recipes])

  // ── grocery scaling ───────────────────────────────────────────────────────
  /** Only cook nights go to the grocery list, scaled to how many serves they make. A
   *  leftover slot is the same batch eaten again — buying for it would double the shop. */
  const grocery = useMemo(() => {
    const scales: Record<number, number> = {}
    for (const e of cookSlots) {
      const recipe = recipeById.get(e.recipeId!)
      if (!recipe) continue
      const factor = (e.servingsPlanned ?? recipe.servings ?? 1) / (recipe.servings ?? 1)
      scales[recipe.id] = (scales[recipe.id] ?? 0) + factor
    }
    return { recipeIds: Object.keys(scales).map(Number), scales }
  }, [cookSlots, recipeById])

  const monday = mondayOfThisWeek()
  const sunday = addDays(monday, 6)
  const weekLabel = `Mon ${dayNum(monday)} – Sun ${dayNum(sunday)} ${monthShort(sunday)}`

  const editingEntry = editing ? slotFor(editing.day, editing.meal) : undefined
  const editingRecipe =
    editingEntry?.recipeId != null ? recipeById.get(editingEntry.recipeId) : undefined
  const editingFood = editingEntry ? planSlotToFood(editingEntry, props.recipes) : null

  /** Cook nights earlier in the week whose batch could still reach this slot. */
  const leftoverSources = useMemo(() => {
    if (!editing) return []
    const idx = DAYS.indexOf(editing.day)
    return cookSlots.filter((c) => {
      const gap = idx - DAYS.indexOf(c.day)
      const recipe = recipeById.get(c.recipeId!)
      if (!recipe || gap <= 0) return false
      return recipe.reheat !== 'fresh-only' && gap <= recipe.keepsDays
    })
  }, [editing, cookSlots, recipeById])

  return (
    <div className="plan">
      <div className="plan__top">
        <span className="plan__week">{weekLabel}</span>
        <PersonSwitcher
          users={users}
          selectedId={current?.id ?? ''}
          onSelect={(u) => {
            setEditing(null)
            props.onSelectViewer(u)
          }}
        />
      </div>

      {readOnly && current && (
        <div className="partner-banner">{current.name}&rsquo;s week — read-only</div>
      )}

      <div className="plan-summary glass-island">
        <div className="plan-summary__top">
          <span className="plan-summary__week">
            {readOnly && current ? `${current.name}'s plan` : 'Your plan'}
          </span>
        </div>
        <div className="plan-summary__stats">
          <span>
            <strong>{cookSlots.length}</strong> to cook
          </span>
          <span>
            <strong>{distinctRecipes}</strong> recipe{distinctRecipes === 1 ? '' : 's'}
          </span>
          <span>
            <strong>{filledSlots.length}</strong>/21 slots
          </span>
          {avgKcal !== null && (
            <span className="plan-summary__kcal">~{avgKcal.toLocaleString()} kcal/day · est.</span>
          )}
        </div>
        {!readOnly && (
          <>
            <div className="plan-summary__actions">
              <button
                className="btn-primary plan-summary__gen"
                onClick={() => setGenerateOpen(true)}
              >
                <Sparkles size={14} strokeWidth={2.4} /> Generate week
              </button>
              <button
                className="btn-secondary"
                onClick={() => setGroceryOpen(true)}
                disabled={grocery.recipeIds.length === 0}
              >
                Send to groceries
              </button>
            </div>
            {/* Lives in the island rather than floating at the end of the page, where the
                dock covered it. */}
            <button
              className="btn-ghost btn-ghost--destructive plan-summary__clear"
              disabled={filledSlots.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              Clear week
            </button>
          </>
        )}
      </div>

      {DAYS.map((day, i) => {
        const date = addDays(monday, i)
        return (
          <div key={day} className="plan-day glass-island">
            <div className="plan-day__label">
              {DAY_SHORT[day]} {dayNum(date)}
            </div>
            {PLAN_MEALS.map((meal) => {
              const entry = slotFor(day, meal)
              const recipe = entry?.recipeId != null ? recipeById.get(entry.recipeId) : undefined
              const filled = recipe != null || Boolean(entry?.freeText)
              const isLeftover = entry?.isLeftover === true
              return (
                <button
                  key={meal}
                  type="button"
                  className={`plan-slot ${isLeftover ? 'plan-slot--leftover' : ''}`}
                  disabled={readOnly}
                  onClick={() => {
                    setEditing({ day, meal })
                    setFreeText(entry?.freeText ?? '')
                  }}
                >
                  <span className="plan-slot__key">{SLOT_KEY[meal]}</span>
                  <span
                    className={`plan-slot__text ${filled ? 'plan-slot__text--filled' : ''} ${
                      recipe && !isLeftover ? 'plan-slot__text--recipe' : ''
                    }`}
                  >
                    {recipe?.title ?? entry?.freeText ?? `Add ${meal}`}
                  </span>
                  {isLeftover && entry?.cookDay && (
                    <span className="plan-slot__chip plan-slot__chip--leftover">
                      from {DAY_SHORT[entry.cookDay]}
                    </span>
                  )}
                  {recipe && !isLeftover && (
                    <span className="plan-slot__chip">
                      cook{entry?.servingsPlanned ? ` · ${entry.servingsPlanned}` : ''}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )
      })}

      {suggestion && !readOnly && (
        <div className="plan-suggest">
          <div className="eyebrow">
            Ideas for {MEAL_LABEL[suggestion.meal].toLowerCase()}
          </div>
          <div className="chip-row">
            {suggestion.options.map((r) => (
              <button
                key={r.id}
                className="suggest-card glass-island"
                onClick={() => setSlot(suggestion.day, suggestion.meal, r.id, null)}
              >
                <span className="suggest-card__title">{r.title}</span>
                <span className="suggest-card__meta">
                  Add to {DAY_SHORT[suggestion.day]}
                  {r.est ? ` · ~${Math.round(r.est.calories)} kcal` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {confirmClear && (
        <ConfirmSheet
          title="Clear the week?"
          body="Every slot in your week is emptied. Your partner's plan and the grocery list are untouched."
          confirmLabel="Clear week"
          onConfirm={clearAll}
          onClose={() => setConfirmClear(false)}
        />
      )}

      {editing && (
        <BottomSheet
          title={`${DAY_SHORT[editing.day]} · ${MEAL_LABEL[editing.meal]}`}
          tall
          onClose={() => setEditing(null)}
        >
          <div className="plan-edit">
            {editingEntry?.isLeftover && editingEntry.cookDay && (
              <p className="plan-edit__note">
                Leftovers from {DAY_SHORT[editingEntry.cookDay]}
                {editingRecipe ? ` · ${editingRecipe.title}` : ''}. Groceries only buy for the
                cook night.
              </p>
            )}

            {/* Actions on what's already here, before the tools to replace it. */}
            {(editingRecipe || editingEntry?.freeText) && (
              <div className="plan-edit__actions">
                {editingFood && (
                  <button
                    className="btn-primary"
                    onClick={() => {
                      props.onLogToTracker(editing.meal, editingFood)
                      setEditing(null)
                    }}
                  >
                    <Utensils size={14} strokeWidth={2.4} /> Log to tracker
                  </button>
                )}
                {editingRecipe && (
                  <button className="btn-ghost" onClick={() => props.onOpenRecipe(editingRecipe.id)}>
                    Open recipe
                  </button>
                )}
                <button
                  className="btn-ghost btn-ghost--destructive"
                  onClick={() => setSlot(editing.day, editing.meal, null, null)}
                >
                  Clear slot
                </button>
              </div>
            )}

            {leftoverSources.length > 0 && (
              <>
                <div className="eyebrow plan-edit__head">Eat leftovers</div>
                <div className="plan-edit__recipes">
                  {leftoverSources.map((c) => {
                    const r = recipeById.get(c.recipeId!)!
                    return (
                      <button
                        key={`${c.day}|${c.meal}`}
                        className="plan-edit__recipe"
                        onClick={() =>
                          setSlot(editing.day, editing.meal, r.id, null, {
                            isLeftover: true,
                            cookDay: c.day,
                            servingsPlanned: null
                          })
                        }
                      >
                        <span>{r.title}</span>
                        <span className="plan-edit__kcal">
                          cooked {DAY_SHORT[c.day]} · keeps {r.keepsDays}d
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            <div className="eyebrow plan-edit__head">Pick a recipe</div>
            <RecipePicker
              recipes={props.recipes}
              onPick={(r) => setSlot(editing.day, editing.meal, r.id, null)}
            />

            <div className="eyebrow plan-edit__head">Or write it in</div>
            <input
              className="input-pill"
              placeholder="e.g. Dinner at Mum's"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && freeText.trim())
                  setSlot(editing.day, editing.meal, null, freeText.trim())
              }}
            />
            <button
              className="btn-secondary plan-edit__save"
              disabled={!freeText.trim()}
              onClick={() => setSlot(editing.day, editing.meal, null, freeText.trim())}
            >
              Save
            </button>
          </div>
        </BottomSheet>
      )}

      {generateOpen && (
        <GenerateWeekSheet
          recipes={props.recipes}
          existing={plan}
          onClose={() => setGenerateOpen(false)}
          onApply={applyWeek}
        />
      )}

      {groceryOpen && (
        <GroceryPreviewModal
          recipeIds={grocery.recipeIds}
          scales={grocery.scales}
          onClose={() => setGroceryOpen(false)}
        />
      )}
    </div>
  )
}
