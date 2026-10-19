import { supabase } from './supabase'
import { myId } from './users'
import type { FoodItem, MealType } from '../../shared/types'
import type { NewLogEntry } from './tracker'

/** A food plus the serving to log — one tap from the Add Food sheet. Macros are per unit,
 *  exactly as food_log stores them, so logging a favourite writes the row the original
 *  logging did. */
export interface FoodFavourite {
  id: number
  foodKey: string
  name: string
  brand: string | null
  barcode: string | null
  unit: string
  amount: number
  baseCalories: number
  baseProtein: number
  baseCarbs: number
  baseFat: number
  baseFibre: number | null
  source: string
  /** "60 g", "1 × 1 slice" — the serving in words */
  label: string | null
}

export type NewFavourite = Omit<FoodFavourite, 'id'>

/** My favourites, oldest first so the strip's order is stable as new ones are added. */
export async function listFavourites(): Promise<FoodFavourite[]> {
  const ownerId = await myId()
  const { data, error } = await supabase
    .from('food_favourites')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id,
    foodKey: r.food_key,
    name: r.name,
    brand: r.brand,
    barcode: r.barcode,
    unit: r.unit,
    amount: r.amount,
    baseCalories: r.base_calories,
    baseProtein: r.base_protein,
    baseCarbs: r.base_carbs,
    baseFat: r.base_fat,
    baseFibre: r.base_fibre ?? null,
    source: r.source,
    label: r.label
  }))
}

/** Save a favourite. The same food at the same serving is one favourite, so saving it
 *  again just refreshes it rather than adding a duplicate tile. */
export async function addFavourite(f: NewFavourite): Promise<void> {
  const ownerId = await myId()
  const { error } = await supabase.from('food_favourites').upsert(
    {
      owner_id: ownerId,
      food_key: f.foodKey,
      name: f.name,
      brand: f.brand,
      barcode: f.barcode,
      unit: f.unit,
      amount: f.amount,
      base_calories: f.baseCalories,
      base_protein: f.baseProtein,
      base_carbs: f.baseCarbs,
      base_fat: f.baseFat,
      base_fibre: f.baseFibre,
      source: f.source,
      label: f.label
    },
    { onConflict: 'owner_id,food_key,unit,amount' }
  )
  if (error) throw new Error(error.message)
}

export async function removeFavourite(id: number): Promise<void> {
  const { error } = await supabase.from('food_favourites').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** A favourite as a food — what the label helpers read to title its tile. */
export function favouriteAsItem(f: FoodFavourite): FoodItem {
  return {
    name: f.name,
    brand: f.brand,
    barcode: f.barcode,
    servingDesc: f.label,
    unit: f.unit,
    calories: f.baseCalories,
    protein: f.baseProtein,
    carbs: f.baseCarbs,
    fat: f.baseFat,
    fibre: f.baseFibre,
    source: 'recent'
  }
}

/** The log entry a favourite stands for, on a given day and meal. */
export function favouriteToEntry(f: FoodFavourite, date: string, mealType: MealType): NewLogEntry {
  return {
    date,
    mealType,
    name: f.name,
    brand: f.brand,
    amount: f.amount,
    unit: f.unit,
    baseCalories: f.baseCalories,
    baseProtein: f.baseProtein,
    baseCarbs: f.baseCarbs,
    baseFat: f.baseFat,
    baseFibre: f.baseFibre,
    barcode: f.barcode,
    source: f.source
  }
}
