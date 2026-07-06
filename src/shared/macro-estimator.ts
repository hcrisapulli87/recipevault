import type { Per100g, RecipeEstimate, RecipeIngredient } from './types'

// Canonical parser units → grams (ml treated as ≈ g; coarse where density varies —
// the whole estimate is a labelled best guess).
const UNIT_GRAMS: Record<string, number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  tsp: 5,
  tbsp: 15,
  cup: 240,
  oz: 28.35,
  lb: 453.6,
  clove: 3,
  can: 400,
  tin: 400,
  slice: 25,
  pinch: 0.3,
  handful: 30,
  pack: 250,
  jar: 300,
  bottle: 500,
  bunch: 100,
  sprig: 2,
  stick: 50,
  knob: 15
}

// Typical whole-item weights for unit-less counts ("2 eggs", "1 onion").
// Multi-word keys first so "chicken breast" wins over any plain "chicken" rule.
const TYPICAL_WEIGHTS: [string, number][] = [
  ['chicken breast', 250],
  ['chicken thigh', 100],
  ['spring onion', 15],
  ['egg', 50],
  ['onion', 150],
  ['potato', 200],
  ['carrot', 60],
  ['tomato', 120],
  ['capsicum', 150],
  ['zucchini', 200],
  ['avocado', 150],
  ['banana', 118],
  ['apple', 180],
  ['sausage', 70],
  ['bacon', 30],
  ['tortilla', 60],
  ['wrap', 60],
  ['roll', 60],
  ['garlic', 3],
  ['chilli', 15],
  ['lime', 45],
  ['lemon', 60],
  ['cucumber', 250],
  ['celery', 40]
]

export interface EstimateDetail {
  name: string
  grams: number | null
  matched: boolean
  calories: number
}

/** Grams for one ingredient, or null when honestly unknown (then it's skipped). */
export function ingredientGrams(
  ing: RecipeIngredient,
  stapleServingGrams: number | null
): number | null {
  const qty =
    ing.quantity === null
      ? null
      : ing.quantityMax !== null
        ? (ing.quantity + ing.quantityMax) / 2
        : ing.quantity
  if (qty === null) return null
  if (ing.unit) return UNIT_GRAMS[ing.unit] !== undefined ? qty * UNIT_GRAMS[ing.unit] : null
  const lower = ing.name.toLowerCase()
  const hit = TYPICAL_WEIGHTS.find(([k]) => lower.includes(k))
  if (hit) return qty * hit[1]
  if (stapleServingGrams !== null) return qty * stapleServingGrams
  return null
}

/**
 * Pure per-serving estimate: matching is the caller's job (one per-100g entry
 * per ingredient, null = no match). servings null → assume 4, flagged.
 */
export function estimateRecipeMacros(
  ingredients: RecipeIngredient[],
  servings: number | null,
  matches: ({ per100g: Per100g; servingGrams: number | null } | null)[]
): { estimate: RecipeEstimate; detail: EstimateDetail[] } {
  let cal = 0
  let pro = 0
  let carb = 0
  let fat = 0
  let matched = 0
  const detail: EstimateDetail[] = ingredients.map((ing, i) => {
    const m = matches[i]
    const grams = ingredientGrams(ing, m?.servingGrams ?? null)
    if (!m || grams === null) return { name: ing.name, grams, matched: false, calories: 0 }
    matched++
    const f = grams / 100
    cal += m.per100g.calories * f
    pro += m.per100g.protein * f
    carb += m.per100g.carbs * f
    fat += m.per100g.fat * f
    return { name: ing.name, grams, matched: true, calories: Math.round(m.per100g.calories * f) }
  })
  const serves = servings ?? 4
  const r1 = (n: number): number => Math.round(n * 10) / 10
  return {
    estimate: {
      calories: Math.round(cal / serves),
      protein: r1(pro / serves),
      carbs: r1(carb / serves),
      fat: r1(fat / serves),
      matched,
      total: ingredients.length,
      assumedServings: servings === null
    },
    detail
  }
}
