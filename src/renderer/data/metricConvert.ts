import { supabase } from './supabase'
import { estimateAndSave } from './macroEstimate'
import { parseIngredient } from '../../shared/ingredient-parser'
import { metricizeLine, metricizeText } from '../../shared/unit-convert'
import type { Recipe } from '../../shared/types'

/**
 * One-time in-place conversion of an existing recipe to metric (oz/lb → g,
 * °F → °C). Rewrites changed ingredient rows (raw + re-parsed fields, keyed
 * recipe_id+position) and step texts, then refreshes the macro estimate.
 */
export async function convertRecipeToMetric(recipe: Recipe): Promise<void> {
  for (const ing of recipe.ingredients) {
    const r = metricizeLine(ing.raw)
    if (!r.changed) continue
    const parsed = parseIngredient(r.text)
    const { error } = await supabase
      .from('ingredients')
      .update({
        raw_text: parsed.raw,
        quantity: parsed.quantity,
        quantity_max: parsed.quantityMax,
        unit: parsed.unit,
        name: parsed.name
      })
      .eq('recipe_id', recipe.id)
      .eq('position', ing.position)
    if (error) throw new Error(error.message)
  }
  for (const s of recipe.steps) {
    const r = metricizeText(s.text)
    if (r.changed === 0) continue
    const { error } = await supabase
      .from('steps')
      .update({ text: r.text })
      .eq('recipe_id', recipe.id)
      .eq('position', s.position)
    if (error) throw new Error(error.message)
  }
  await estimateAndSave(recipe.id)
}
