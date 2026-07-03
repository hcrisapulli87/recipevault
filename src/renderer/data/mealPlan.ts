import { supabase } from './supabase'
import { DAYS } from '../../shared/types'
import type { Day, MealPlanEntry } from '../../shared/types'

/** The week for one household member. Policies allow reading both users' plans,
 *  so scoping is explicit now — pass the id from the Me/partner switcher. */
export async function getMealPlan(ownerId: string): Promise<MealPlanEntry[]> {
  const { data, error } = await supabase
    .from('meal_plan')
    .select('day, recipe_id, free_text')
    .eq('owner_id', ownerId)
  if (error) throw new Error(error.message)
  const byDay = new Map((data ?? []).map((r) => [r.day as Day, r]))
  return DAYS.map((day) => {
    const r = byDay.get(day)
    return { day, recipeId: r?.recipe_id ?? null, freeText: r?.free_text ?? null }
  })
}

/**
 * Upsert one day. `mealText` is a denormalised label (recipe title or free text) the Discord
 * bot can read over REST without a join.
 */
export async function setMeal(args: {
  day: Day
  recipeId: number | null
  freeText: string | null
  mealText: string | null
}): Promise<void> {
  const { error } = await supabase.from('meal_plan').upsert(
    {
      day: args.day,
      recipe_id: args.recipeId,
      free_text: args.freeText,
      meal_text: args.mealText
    },
    { onConflict: 'owner_id,day' }
  )
  if (error) throw new Error(error.message)
}

export async function clearWeek(): Promise<void> {
  const { error } = await supabase.from('meal_plan').delete().in('day', DAYS)
  if (error) throw new Error(error.message)
}
