import { formatQuantity } from './ingredient-parser'
import type { MergedGroceryItem, ParsedIngredient } from './types'

// Combines a week's ingredients into one grocery line per distinct ingredient:
// quantities sum when units match; mismatched units sit side by side on one line.

export function normaliseName(name: string): string {
  let n = name
    .toLowerCase()
    .replace(/\s*\(.*\)\s*$/, '') // strip a "(3)" / "(200 g)" suffix from grocery titles
    .replace(/\s+/g, ' ')
    .trim()
  // Plural → singular for the common English patterns. A bare trailing-s strip turned
  // "tomatoes" into "tomatoe" and "berries" into "berrie", so they never merged with
  // "tomato"/"berry" from another recipe.
  if (n.length > 4 && n.endsWith('ies')) n = `${n.slice(0, -3)}y`
  else if (n.length > 4 && /(oes|ches|shes|sses|xes)$/.test(n)) n = n.slice(0, -2)
  else if (n.length > 3 && n.endsWith('s') && !n.endsWith('ss')) n = n.slice(0, -1)
  return n
}

/** Metric units that sum into a base unit, so "500 g" + "1 kg" reads "1 ½ kg" rather
 *  than two parts side by side. */
const METRIC_BASE: Record<string, { unit: string; factor: number }> = {
  kg: { unit: 'g', factor: 1000 },
  l: { unit: 'ml', factor: 1000 }
}

export function mergeIngredients(ingredients: ParsedIngredient[]): MergedGroceryItem[] {
  const byName = new Map<string, MergedGroceryItem>()
  for (const ing of ingredients) {
    const key = normaliseName(ing.name)
    let item = byName.get(key)
    if (!item) {
      item = { name: ing.name, parts: [] }
      byName.set(key, item)
    }
    if (ing.quantity === null) continue
    // ranges count as their lower bound for shopping purposes
    const base = ing.unit ? METRIC_BASE[ing.unit] : undefined
    const unit = base ? base.unit : ing.unit
    const quantity = base ? ing.quantity * base.factor : ing.quantity
    const part = item.parts.find((p) => p.unit === unit)
    if (part) {
      part.quantity += quantity
    } else {
      item.parts.push({ quantity, unit })
    }
  }
  return [...byName.values()]
}

export function groceryTitle(item: MergedGroceryItem): string {
  const name = item.name.charAt(0).toUpperCase() + item.name.slice(1)
  if (item.parts.length === 0) return name
  const qty = item.parts
    .map((p) => {
      // Summed grams/millilitres read back in kg/L once they reach a whole one.
      if (p.unit === 'g' && p.quantity >= 1000) return `${formatQuantity(p.quantity / 1000)} kg`
      if (p.unit === 'ml' && p.quantity >= 1000) return `${formatQuantity(p.quantity / 1000)} l`
      return p.unit ? `${formatQuantity(p.quantity)} ${p.unit}` : formatQuantity(p.quantity)
    })
    .join(' + ')
  return `${name} (${qty})`
}
