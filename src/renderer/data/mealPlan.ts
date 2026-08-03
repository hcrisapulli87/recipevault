import { supabase } from './supabase'
import { DAYS, PLAN_MEALS } from '../../shared/types'
import type { Day, MealPlanEntry, PlanMeal } from '../../shared/types'

const PLAN_COLS = 'day, meal, recipe_id, free_text, is_leftover, cook_day, servings_planned'

/** The shared household week: 21 slots (7 days × breakfast/lunch/dinner),
 *  blanks filled in. One plan for both users — no owner scoping. */
export async function getMealPlan(): Promise<MealPlanEntry[]> {
  const { data, error } = await supabase.from('meal_plan').select(PLAN_COLS)
  if (error) throw new Error(error.message)
  const bySlot = new Map((data ?? []).map((r) => [`${r.day}|${r.meal}`, r]))
  return DAYS.flatMap((day) =>
    PLAN_MEALS.map((meal) => {
      const r = bySlot.get(`${day}|${meal}`)
      return {
        day,
        meal,
        recipeId: r?.recipe_id ?? null,
        freeText: r?.free_text ?? null,
        isLeftover: r?.is_leftover ?? false,
        cookDay: (r?.cook_day as Day | null) ?? null,
        servingsPlanned: r?.servings_planned ?? null
      }
    })
  )
}

/** One slot as the database stores it. Split out so setMeal and applyGeneratedWeek build
 *  rows identically — the Discord bot reads `meal_text` and a missing label blanks its
 *  nightly post. */
function toRow(args: {
  day: Day
  meal: PlanMeal
  recipeId: number | null
  freeText: string | null
  mealText: string | null
  isLeftover?: boolean
  cookDay?: Day | null
  servingsPlanned?: number | null
}): Record<string, unknown> {
  return {
    day: args.day,
    meal: args.meal,
    recipe_id: args.recipeId,
    free_text: args.freeText,
    meal_text: args.mealText,
    is_leftover: args.isLeftover ?? false,
    cook_day: args.cookDay ?? null,
    servings_planned: args.servingsPlanned ?? null
  }
}

/**
 * Upsert one slot. `mealText` is a denormalised label (recipe title or free text) the Discord
 * bot can read over REST without a join.
 */
export async function setMeal(args: {
  day: Day
  meal: PlanMeal
  recipeId: number | null
  freeText: string | null
  mealText: string | null
  isLeftover?: boolean
  cookDay?: Day | null
  servingsPlanned?: number | null
}): Promise<void> {
  const { error } = await supabase
    .from('meal_plan')
    .upsert(toRow(args), { onConflict: 'day,meal' })
  if (error) throw new Error(error.message)
}

/**
 * Write a whole generated week in one round trip. Slots the generator left empty are
 * deleted rather than upserted as blanks, so `getMealPlan`'s blank-filling stays the single
 * definition of "empty" and the table never accumulates 21 placeholder rows.
 */
export async function applyGeneratedWeek(
  entries: MealPlanEntry[],
  labelFor: (entry: MealPlanEntry) => string | null
): Promise<void> {
  const filled = entries.filter((e) => e.recipeId !== null || e.freeText !== null)
  const empty = entries.filter((e) => e.recipeId === null && e.freeText === null)

  if (filled.length > 0) {
    const { error } = await supabase.from('meal_plan').upsert(
      filled.map((e) =>
        toRow({
          day: e.day,
          meal: e.meal,
          recipeId: e.recipeId,
          freeText: e.freeText,
          mealText: labelFor(e),
          isLeftover: e.isLeftover,
          cookDay: e.cookDay,
          servingsPlanned: e.servingsPlanned
        })
      ),
      { onConflict: 'day,meal' }
    )
    if (error) throw new Error(error.message)
  }

  // `.or()` per slot would be 21 clauses; deleting by (day, meal) pairs one day at a time
  // keeps it to at most 7 statements and reads plainly.
  for (const day of DAYS) {
    const meals = empty.filter((e) => e.day === day).map((e) => e.meal)
    if (meals.length === 0) continue
    const { error } = await supabase.from('meal_plan').delete().eq('day', day).in('meal', meals)
    if (error) throw new Error(error.message)
  }
}

export async function clearWeek(): Promise<void> {
  const { error } = await supabase.from('meal_plan').delete().in('day', DAYS)
  if (error) throw new Error(error.message)
}
