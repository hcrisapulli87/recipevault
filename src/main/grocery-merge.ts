import { formatQuantity } from '../shared/ingredient-parser'
import type { MergedGroceryItem, ParsedIngredient } from '../shared/types'

// Combines a week's ingredients into one grocery line per distinct ingredient:
// quantities sum when units match; mismatched units sit side by side on one line.

export function normaliseName(name: string): string {
  let n = name
    .toLowerCase()
    .replace(/\s*\(.*\)\s*$/, '') // strip a "(3)" / "(200 g)" suffix from grocery titles
    .replace(/\s+/g, ' ')
    .trim()
  if (n.length > 3 && n.endsWith('s')) n = n.slice(0, -1)
  return n
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
    const part = item.parts.find((p) => p.unit === ing.unit)
    if (part) {
      part.quantity += ing.quantity
    } else {
      item.parts.push({ quantity: ing.quantity, unit: ing.unit })
    }
  }
  return [...byName.values()]
}

export function groceryTitle(item: MergedGroceryItem): string {
  const name = item.name.charAt(0).toUpperCase() + item.name.slice(1)
  if (item.parts.length === 0) return name
  const qty = item.parts
    .map((p) => (p.unit ? `${formatQuantity(p.quantity)} ${p.unit}` : formatQuantity(p.quantity)))
    .join(' + ')
  return `${name} (${qty})`
}
