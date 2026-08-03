import { MEAL_LABEL } from './types'
import type { FoodItem, MealPlanEntry, MealType, RecipeSummary } from './types'

/**
 * A planned recipe as a ready-to-log tracker item.
 *
 * Both directions of the plan/tracker bridge run through here: the tracker's "log the
 * planned meal" card and the planner's per-slot "Log to tracker" action. Keeping one
 * implementation means a leftover night logs exactly the same macros as the night it was
 * cooked — which is the entire point of a leftover slot pointing at the same recipe.
 *
 * Returns null when the recipe has no macro estimate: logging zeroes would silently
 * flatten the day's totals, and no entry is more honest than a wrong one.
 */
export function planItemToFood(
  recipe: RecipeSummary,
  meal: MealType,
  opts: { isLeftover?: boolean } = {}
): FoodItem | null {
  if (!recipe.est) return null

  const parts = [`planned ${MEAL_LABEL[meal].toLowerCase()}`]
  if (opts.isLeftover) parts.push('leftovers')
  parts.push('best-guess macros')

  return {
    name: recipe.title,
    brand: null,
    barcode: null,
    servingDesc: parts.join(' · '),
    unit: 'serving',
    calories: recipe.est.calories,
    protein: recipe.est.protein,
    carbs: recipe.est.carbs,
    fat: recipe.est.fat,
    source: 'plan'
  }
}

/**
 * The same thing for a planner slot: resolves the slot's recipe and carries its leftover
 * flag through. Free-text slots ("Dinner at Mum's") have no macros to log, so they yield
 * null too.
 */
export function planSlotToFood(
  entry: MealPlanEntry,
  recipes: RecipeSummary[]
): FoodItem | null {
  if (entry.recipeId === null) return null
  const recipe = recipes.find((r) => r.id === entry.recipeId)
  if (!recipe) return null
  return planItemToFood(recipe, entry.meal, { isLeftover: entry.isLeftover })
}
