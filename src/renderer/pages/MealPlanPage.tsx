import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Day, MealPlanEntry, RecipeSummary } from '../../shared/types'
import { GroceryPreviewModal } from '../components/GroceryPreviewModal'

const DAY_LABEL: Record<Day, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday'
}

function DayRow(props: {
  entry: MealPlanEntry
  recipes: RecipeSummary[]
  onSet: (recipeId: number | null, freeText: string | null) => void
  onOpenRecipe: (id: number) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const { entry, recipes } = props

  const recipe = entry.recipeId !== null ? recipes.find((r) => r.id === entry.recipeId) : undefined
  const matches =
    query.trim() === ''
      ? recipes
      : recipes.filter((r) => r.title.toLowerCase().includes(query.toLowerCase()))

  const choose = (recipeId: number | null, freeText: string | null): void => {
    props.onSet(recipeId, freeText)
    setEditing(false)
    setQuery('')
  }

  return (
    <div className="plan-row">
      <span className="plan-row__day">{DAY_LABEL[entry.day]}</span>

      {editing ? (
        <div className="plan-row__editor">
          <input
            autoFocus
            className="text-input"
            placeholder="Search recipes or type a meal…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter' && query.trim()) choose(null, query.trim())
            }}
          />
          {matches.length > 0 && (
            <ul className="plan-row__suggestions">
              {matches.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <button className="plan-row__suggestion" onClick={() => choose(r.id, null)}>
                    📖 {r.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() && (
            <button className="link-btn" onClick={() => choose(null, query.trim())}>
              Use “{query.trim()}” as free text ↵
            </button>
          )}
        </div>
      ) : (
        <div className="plan-row__content">
          {recipe ? (
            <button
              className="link-btn plan-row__meal"
              onClick={() => props.onOpenRecipe(recipe.id)}
            >
              📖 {recipe.title}
            </button>
          ) : entry.freeText ? (
            <span className="plan-row__meal">{entry.freeText}</span>
          ) : (
            <span className="plan-row__empty">—</span>
          )}
          <div className="plan-row__btns">
            <button className="icon-btn" title="Edit" onClick={() => setEditing(true)}>
              ✏️
            </button>
            {(entry.recipeId !== null || entry.freeText) && (
              <button className="icon-btn" title="Clear" onClick={() => choose(null, null)}>
                ✕
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function MealPlanPage(props: {
  recipes: RecipeSummary[]
  onOpenRecipe: (id: number) => void
}): JSX.Element {
  const [plan, setPlan] = useState<MealPlanEntry[]>([])
  const [warning, setWarning] = useState<string | null>(null)
  const [groceryOpen, setGroceryOpen] = useState(false)

  const reload = useCallback(() => {
    window.api.getMealPlan().then(setPlan)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const setDay = async (
    day: Day,
    recipeId: number | null,
    freeText: string | null
  ): Promise<void> => {
    const result = await window.api.setMeal({ day, recipeId, freeText })
    setWarning(result.warning ?? null)
    reload()
  }

  const clearAll = async (): Promise<void> => {
    if (!window.confirm('Clear the whole week?')) return
    const result = await window.api.clearWeek()
    setWarning(result.warning ?? null)
    reload()
  }

  const plannedRecipeIds = [
    ...new Set(plan.filter((e) => e.recipeId !== null).map((e) => e.recipeId as number))
  ]

  return (
    <div>
      <div className="page-header">
        <h2 className="page-header__title">This week</h2>
        <button
          className="btn btn--primary"
          onClick={() => setGroceryOpen(true)}
          disabled={plannedRecipeIds.length === 0}
        >
          🛒 Send week to groceries
        </button>
        <button className="btn" onClick={clearAll}>
          Clear week
        </button>
      </div>

      {warning && (
        <div className="banner banner--warn">
          {warning}{' '}
          <button className="link-btn" onClick={() => setWarning(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="plan-grid">
        {plan.map((entry) => (
          <DayRow
            key={entry.day}
            entry={entry}
            recipes={props.recipes}
            onSet={(recipeId, freeText) => setDay(entry.day, recipeId, freeText)}
            onOpenRecipe={props.onOpenRecipe}
          />
        ))}
      </div>

      <p className="plan-note">
        The plan syncs to the Discord bot — <code>!mealplan</code> shows it, and the bot posts it
        every Sunday evening. Days set with <code>!setmeal</code> show up here too.
      </p>

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
