import { supabase } from './supabase'
import { DAYS, PLAN_MEALS } from '../../shared/types'
import type { Day, MealPlanEntry, PlanMeal } from '../../shared/types'

/** The shared household week: 21 slots (7 days × breakfast/lunch/dinner),
 *  blanks filled in. One plan for both users — no owner scoping. */
export async function getMealPlan(): Promise<MealPlanEntry[]> {
  const { data, error } = await supabase.from('meal_plan').select('day, meal, recipe_id, free_text')
  if (error) throw new Error(error.message)
  const bySlot = new Map((data ?? []).map((r) => [`${r.day}|${r.meal}`, r]))
  return DAYS.flatMap((day) =>
    PLAN_MEALS.map((meal) => {
      const r = bySlot.get(`${day}|${meal}`)
      return { day, meal, recipeId: r?.recipe_id ?? null, freeText: r?.free_text ?? null }
    })
  )
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
}): Promise<void> {
  const { error } = await supabase.from('meal_plan').upsert(
    {
      day: args.day,
      meal: args.meal,
      recipe_id: args.recipeId,
      free_text: args.freeText,
      meal_text: args.mealText
    },
    { onConflict: 'day,meal' }
  )
  if (error) throw new Error(error.message)
}

export async function clearWeek(): Promise<void> {
  const { error } = await supabase.from('meal_plan').delete().in('day', DAYS)
  if (error) throw new Error(error.message)
}
