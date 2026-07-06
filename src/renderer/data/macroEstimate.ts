import { supabase } from './supabase'
import { FOOD_SEARCH_ENDPOINT } from './foods'
import { getRecipe } from './recipes'
import { staplePer100g } from '../../shared/nutrition'
import { estimateRecipeMacros } from '../../shared/macro-estimator'
import type { EstimateDetail } from '../../shared/macro-estimator'
import type { Per100g, Recipe, RecipeEstimate } from '../../shared/types'

type Match = { per100g: Per100g; servingGrams: number | null } | null

/** "boneless chicken thighs (skin off), diced" → "boneless chicken thighs" */
function cleanName(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .split(',')[0]
    .trim()
}

async function lookupPer100g(name: string): Promise<Match> {
  const q = cleanName(name)
  if (!q) return null
  const staple = staplePer100g(q)
  if (staple) return staple
  try {
    const res = await fetch(`${FOOD_SEARCH_ENDPOINT}?q=${encodeURIComponent(q)}`)
    if (!res.ok) return null
    const data = (await res.json()) as {
      ok?: boolean
      products?: { nutriments?: Record<string, number | string> }[]
    }
    if (!data.ok) return null
    for (const p of data.products ?? []) {
      const n = p.nutriments
      const cal = Number(n?.['energy-kcal_100g'])
      if (n && Number.isFinite(cal)) {
        return {
          per100g: {
            calories: cal,
            protein: Number(n.proteins_100g) || 0,
            carbs: Number(n.carbohydrates_100g) || 0,
            fat: Number(n.fat_100g) || 0
          },
          servingGrams: null
        }
      }
    }
  } catch {
    // offline — staples may still have matched other ingredients
  }
  return null
}

/** Match every ingredient (staples → proxy, sequential) and run the pure estimator. */
export async function computeRecipeEstimate(
  recipe: Recipe
): Promise<{ estimate: RecipeEstimate; detail: EstimateDetail[] }> {
  const matches: Match[] = []
  for (const ing of recipe.ingredients) matches.push(await lookupPer100g(ing.name))
  return estimateRecipeMacros(recipe.ingredients, recipe.servings, matches)
}

export async function saveRecipeEstimate(id: number, e: RecipeEstimate): Promise<void> {
  const { error } = await supabase
    .from('recipes')
    .update({
      est_cal_serve: e.calories,
      est_protein_serve: e.protein,
      est_carbs_serve: e.carbs,
      est_fat_serve: e.fat,
      est_matched: e.matched,
      est_total: e.total,
      est_computed_at: new Date().toISOString()
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** Fire-and-forget after save/import: compute + persist, silently tolerant. */
export async function estimateAndSave(recipeId: number): Promise<void> {
  try {
    const recipe = await getRecipe(recipeId)
    if (!recipe || recipe.ingredients.length === 0) return
    const { estimate } = await computeRecipeEstimate(recipe)
    await saveRecipeEstimate(recipeId, estimate)
  } catch {
    // best-effort — the detail page's Estimate button always recovers
  }
}
