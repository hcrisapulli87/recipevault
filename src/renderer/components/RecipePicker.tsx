import { useState } from 'react'
import type { JSX } from 'react'
import type { PlanMeal, RecipeSummary } from '../../shared/types'

/**
 * Search box + tappable list of recipes. Shared by the planner's slot editor and the
 * Generate-week wizard's "pick this one myself" action, so both search the same pool and
 * show the same rows.
 *
 * `meal` narrows the list to recipes that suit that slot — offering a lasagne as a
 * breakfast is noise, and the wizard picks always target a known slot.
 */
export function RecipePicker(props: {
  recipes: RecipeSummary[]
  meal?: PlanMeal
  onPick: (recipe: RecipeSummary) => void
  /** Cap on rendered rows; the search box is how you reach the rest. */
  limit?: number
}): JSX.Element {
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()

  const matches = props.recipes.filter((r) => {
    if (props.meal && !r.mealSlots.includes(props.meal)) return false
    return r.title.toLowerCase().includes(term)
  })

  return (
    <>
      <input
        className="input-pill"
        placeholder="Search recipes and catalog"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="plan-edit__recipes">
        {matches.slice(0, props.limit ?? 40).map((r) => (
          <button key={r.id} className="plan-edit__recipe" onClick={() => props.onPick(r)}>
            <span>{r.title}</span>
            {r.est && <span className="plan-edit__kcal">~{Math.round(r.est.calories)} kcal</span>}
          </button>
        ))}
        {matches.length === 0 && <p className="addfood__note">No recipes match that search.</p>}
      </div>
    </>
  )
}
