import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { MEAL_LABEL } from '../../shared/types'
import type { Day, MealPlanEntry, PlanMeal, RecipeSummary } from '../../shared/types'
import { BottomSheet } from '../components/BottomSheet'
import { GroceryPreviewModal } from '../components/GroceryPreviewModal'
import { getMealPlan, setMeal, clearWeek } from '../data/mealPlan'
import { onTableChange } from '../data/realtime'

const DAY_ORDER: Day[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
]
const SLOT_KEY: Record<PlanMeal, string> = { breakfast: 'B', lunch: 'L', dinner: 'D' }
const PLAN_SLOTS: PlanMeal[] = ['breakfast', 'lunch', 'dinner']

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
  onOpenRecipe: (id: number) => void
}): JSX.Element {
  const [plan, setPlan] = useState<MealPlanEntry[]>([])
  const [groceryOpen, setGroceryOpen] = useState(false)
  const [editing, setEditing] = useState<{ day: Day; meal: PlanMeal } | null>(null)
  const [freeText, setFreeText] = useState('')

  // One shared household plan — both users edit the same week (Supabase realtime
  // keeps the two phones in sync).
  const reload = useCallback(() => {
    getMealPlan().then(setPlan)
  }, [])

  useEffect(() => {
    reload()
    return onTableChange(['meal_plan'], reload)
  }, [reload])

  const setSlot = async (
    day: Day,
    meal: PlanMeal,
    recipeId: number | null,
    text: string | null
  ): Promise<void> => {
    const mealText =
      recipeId !== null ? (props.recipes.find((r) => r.id === recipeId)?.title ?? null) : text
    await setMeal({ day, meal, recipeId, freeText: text, mealText })
    setEditing(null)
    setFreeText('')
    reload()
  }

  const clearAll = async (): Promise<void> => {
    if (!window.confirm('Clear the whole week?')) return
    await clearWeek()
    reload()
  }

  const slotFor = (day: Day, meal: PlanMeal): MealPlanEntry | undefined =>
    plan.find((e) => e.day === day && e.meal === meal)

  const plannedRecipeIds = [
    ...new Set(plan.filter((e) => e.recipeId !== null).map((e) => e.recipeId as number))
  ]

  const monday = mondayOfThisWeek()
  const sunday = addDays(monday, 6)
  const weekLabel = `Mon ${dayNum(monday)} – Sun ${dayNum(sunday)} ${monthShort(sunday)}`

  const editingEntry = editing ? slotFor(editing.day, editing.meal) : undefined

  return (
    <div className="plan">
      <div className="plan__meta-row">
        <span className="plan__meta">{weekLabel} · shared</span>
        <button
          className="btn-secondary plan__send"
          onClick={() => setGroceryOpen(true)}
          disabled={plannedRecipeIds.length === 0}
        >
          Send week to groceries
        </button>
      </div>

      {DAY_ORDER.map((day, i) => {
        const date = addDays(monday, i)
        return (
          <div key={day} className="plan-day glass-island">
            <div className="plan-day__label">
              {date.toLocaleDateString(undefined, { weekday: 'short' })} {dayNum(date)}
            </div>
            {PLAN_SLOTS.map((meal) => {
              const entry = slotFor(day, meal)
              const recipe =
                entry?.recipeId != null
                  ? props.recipes.find((r) => r.id === entry.recipeId)
                  : undefined
              const filled = recipe != null || Boolean(entry?.freeText)
              return (
                <div
                  key={meal}
                  className="plan-slot"
                  role="button"
                  onClick={() => {
                    setEditing({ day, meal })
                    setFreeText(entry?.freeText ?? '')
                  }}
                >
                  <span className="plan-slot__key">{SLOT_KEY[meal]}</span>
                  <span
                    className={`plan-slot__text ${filled ? 'plan-slot__text--filled' : ''} ${recipe ? 'plan-slot__text--recipe' : ''}`}
                  >
                    {recipe?.title ?? entry?.freeText ?? `Add ${meal}`}
                  </span>
                  {recipe && <span className="plan-slot__chip">recipe</span>}
                </div>
              )
            })}
          </div>
        )
      })}

      <button className="btn-ghost btn-ghost--destructive plan__clear" onClick={clearAll}>
        Clear week
      </button>

      {editing && (
        <BottomSheet
          title={`${editing.day.charAt(0).toUpperCase() + editing.day.slice(1, 3)} · ${MEAL_LABEL[editing.meal]}`}
          onClose={() => setEditing(null)}
        >
          <div className="plan-edit">
            <input
              className="input-pill"
              placeholder="Free text (e.g. Leftovers)"
              value={freeText}
              autoFocus
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && freeText.trim())
                  setSlot(editing.day, editing.meal, null, freeText.trim())
              }}
            />
            <div className="plan-edit__actions">
              <button
                className="btn-primary"
                disabled={!freeText.trim()}
                onClick={() => setSlot(editing.day, editing.meal, null, freeText.trim())}
              >
                Save
              </button>
              {(editingEntry?.recipeId != null || editingEntry?.freeText) && (
                <button
                  className="btn-ghost btn-ghost--destructive"
                  onClick={() => setSlot(editing.day, editing.meal, null, null)}
                >
                  Clear slot
                </button>
              )}
            </div>
            <div className="eyebrow plan-edit__head">Or pick a recipe</div>
            <div className="plan-edit__recipes">
              {props.recipes.map((r) => (
                <button
                  key={r.id}
                  className="plan-edit__recipe"
                  onClick={() => setSlot(editing.day, editing.meal, r.id, null)}
                >
                  <span>{r.title}</span>
                  {r.est && (
                    <span className="plan-edit__kcal">~{Math.round(r.est.calories)} kcal</span>
                  )}
                </button>
              ))}
              {props.recipes.length === 0 && (
                <p className="addfood__note">No saved recipes yet — import one first.</p>
              )}
            </div>
          </div>
        </BottomSheet>
      )}

      {groceryOpen && (
        <GroceryPreviewModal
          recipeIds={plannedRecipeIds}
          scales={{}}
          onClose={() => setGroceryOpen(false)}
        />
      )}
    </div>
  )
}
