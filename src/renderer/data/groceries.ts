import { supabase } from './supabase'
import { myId } from './users'
import { getRecipe } from './recipes'
import { mergeIngredients, groceryTitle } from '../../shared/grocery-merge'
import { scaleIngredient } from '../../shared/ingredient-parser'
import type { GroceryItem, ParsedIngredient } from '../../shared/types'

/** One person's list. The partner's is readable (RLS allows it) so the UI can show it
 *  read-only behind the Me/partner switcher, but every write below is owner-scoped. */
export async function listGroceries(ownerId: string): Promise<GroceryItem[]> {
  const { data, error } = await supabase
    .from('grocery_items')
    .select('id, name, qty_text, checked, sort_order')
    .eq('owner_id', ownerId)
    .order('checked', { ascending: true })
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    qtyText: r.qty_text,
    checked: r.checked,
    sortOrder: r.sort_order
  }))
}

/** Append items to my list (after any existing ones). Names may embed quantity, e.g. "Onions (3)". */
export async function addGroceries(names: string[]): Promise<void> {
  const clean = names.map((n) => n.trim()).filter(Boolean)
  if (clean.length === 0) return
  const ownerId = await myId()
  // sort_order runs per list, so the partner's items can't push mine down the order.
  const { data: maxRow } = await supabase
    .from('grocery_items')
    .select('sort_order')
    .eq('owner_id', ownerId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  let order = (maxRow?.sort_order ?? 0) + 1
  const rows = clean.map((name) => ({ owner_id: ownerId, name, sort_order: order++ }))
  const { error } = await supabase.from('grocery_items').insert(rows)
  if (error) throw new Error(error.message)
}

export async function toggleGrocery(id: string, checked: boolean): Promise<void> {
  const { error } = await supabase.from('grocery_items').update({ checked }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteGrocery(id: string): Promise<void> {
  const { error } = await supabase.from('grocery_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function clearChecked(): Promise<void> {
  const ownerId = await myId()
  const { error } = await supabase
    .from('grocery_items')
    .delete()
    .eq('owner_id', ownerId)
    .eq('checked', true)
  if (error) throw new Error(error.message)
}

/** Empty my whole list, ticked or not — the "start the week again" button. */
export async function clearAll(): Promise<void> {
  const ownerId = await myId()
  const { error } = await supabase.from('grocery_items').delete().eq('owner_id', ownerId)
  if (error) throw new Error(error.message)
}

/**
 * Merge the ingredients of the given recipes (scaled) into a deduplicated shopping list of
 * display strings — the client-side equivalent of the old previewGroceries IPC.
 */
export async function previewGroceries(
  recipeIds: number[],
  scales: Record<number, number>
): Promise<string[]> {
  const all: ParsedIngredient[] = []
  for (const id of recipeIds) {
    const recipe = await getRecipe(id)
    if (!recipe) continue
    const factor = scales[id] ?? 1
    all.push(...recipe.ingredients.map((ing) => scaleIngredient(ing, factor)))
  }
  return mergeIngredients(all).map(groceryTitle)
}
