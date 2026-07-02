import { supabase } from './supabase'
import { searchStaples, mapOffProduct } from '../../shared/nutrition'
import type { FoodItem } from '../../shared/types'

// OpenFoodFacts is called directly from the browser (it sends Access-Control-Allow-Origin: *).
const OFF_BASE = 'https://world.openfoodfacts.org'
const OFF_FIELDS = 'product_name,brands,code,serving_size,serving_quantity,nutriments'

/** Bundled offline staples first, then OpenFoodFacts text search. Degrades to staples offline. */
export async function searchFoods(query: string): Promise<FoodItem[]> {
  const staples = searchStaples(query)

  let off: FoodItem[] = []
  try {
    const url =
      `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
      `&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`
    const res = await fetch(url)
    if (res.ok) {
      const data = (await res.json()) as { products?: unknown[] }
      off = (data.products ?? [])
        .map((p) => mapOffProduct(p as never, 'search'))
        .filter((x): x is FoodItem => x !== null)
    }
  } catch {
    // offline — staples still returned
  }

  const seen = new Set(staples.map((s) => s.name.toLowerCase()))
  const merged = [...staples]
  for (const item of off) {
    const k = item.name.toLowerCase()
    if (!seen.has(k)) {
      merged.push(item)
      seen.add(k)
    }
  }
  return merged.slice(0, 30)
}

/** Look up a barcode: per-user cache first, then OpenFoodFacts (and cache the result). */
export async function lookupBarcode(barcode: string): Promise<FoodItem | null> {
  const { data: cached } = await supabase
    .from('food_cache')
    .select(
      'barcode, name, brand, serving_desc, unit, cal_per_unit, protein_per_unit, carbs_per_unit, fat_per_unit'
    )
    .eq('barcode', barcode)
    .maybeSingle()
  if (cached) {
    return {
      name: cached.name,
      brand: cached.brand,
      barcode: cached.barcode,
      servingDesc: cached.serving_desc,
      unit: cached.unit,
      calories: cached.cal_per_unit,
      protein: cached.protein_per_unit,
      carbs: cached.carbs_per_unit,
      fat: cached.fat_per_unit,
      source: 'barcode'
    }
  }

  let item: FoodItem | null = null
  try {
    const res = await fetch(`${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`)
    if (res.ok) {
      const data = (await res.json()) as { status?: number; product?: unknown }
      if (data.status === 1 && data.product) {
        item = mapOffProduct(data.product as never, 'barcode')
        if (item && !item.barcode) item.barcode = barcode
      }
    }
  } catch {
    // offline
  }

  if (item) {
    // Best-effort cache (owner_id defaults to auth.uid()); ignore check-constraint/RLS errors.
    await supabase.from('food_cache').upsert(
      {
        barcode: item.barcode,
        name: item.name,
        brand: item.brand,
        serving_desc: item.servingDesc,
        unit: item.unit,
        cal_per_unit: item.calories,
        protein_per_unit: item.protein,
        carbs_per_unit: item.carbs,
        fat_per_unit: item.fat
      },
      { onConflict: 'owner_id,barcode' }
    )
  }
  return item
}
