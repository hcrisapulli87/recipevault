import { supabase } from './supabase'
import { searchStaples, mapOffProduct } from '../../shared/nutrition'
import type { FoodItem } from '../../shared/types'

// Text search goes through our Vercel proxy (api/food-search.ts): OFF's ranked
// Search-a-licious API sends no CORS headers, so the browser can't call it directly.
// DEV → same-origin (the vite dev proxy forwards /api to the deployed origin);
// desktop production → derived from VITE_SCRAPE_URL (same origin, sibling function).
export const FOOD_SEARCH_ENDPOINT = import.meta.env.DEV
  ? '/api/food-search'
  : import.meta.env.VITE_SCRAPE_URL
    ? (import.meta.env.VITE_SCRAPE_URL as string).replace(/scrape$/, 'food-search')
    : '/api/food-search'

// Barcode lookups still hit OFF directly — the v2 product endpoint sends ACAO: *
// and isn't the rate-limited search endpoint.
const OFF_BASE = 'https://world.openfoodfacts.org'
const OFF_FIELDS = 'product_name,brands,code,serving_size,serving_quantity,nutriments'

export interface FoodSearchResult {
  items: FoodItem[]
  /** False when the online product search failed (offline, or OpenFoodFacts down)
   *  and only the bundled staples could be searched — the UI says so instead of
   *  presenting a misleading "no matches". */
  online: boolean
}

/** Bundled offline staples first, then the AU-first proxy search. Degrades to staples offline. */
export async function searchFoods(query: string): Promise<FoodSearchResult> {
  const staples = searchStaples(query)

  let off: FoodItem[] = []
  let online = false
  try {
    const res = await fetch(`${FOOD_SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`)
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; products?: unknown[] }
      if (data.ok) {
        online = true
        off = (data.products ?? [])
          .map((p) => mapOffProduct(p as never, 'search'))
          .filter((x): x is FoodItem => x !== null)
      }
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
  return { items: merged.slice(0, 30), online }
}

export interface BarcodeLookupResult {
  item: FoodItem | null
  /** False when OpenFoodFacts couldn't be reached — "couldn't check" is not
   *  "not found", and the UI must not offer to cache a manual entry for a
   *  barcode OFF may actually know. */
  online: boolean
  /** True when the item came from the per-user food_cache rather than OFF. */
  fromCache: boolean
}

/** Look up a barcode: per-user cache first, then OpenFoodFacts (and cache the result).
 *  `skipCache` forces a fresh OFF fetch — the escape hatch for stale/typo'd cache rows. */
export async function lookupBarcode(
  barcode: string,
  opts: { skipCache?: boolean } = {}
): Promise<BarcodeLookupResult> {
  if (!opts.skipCache) {
    const { data: cached } = await supabase
      .from('food_cache')
      .select(
        'barcode, name, brand, serving_desc, unit, cal_per_unit, protein_per_unit, carbs_per_unit, fat_per_unit'
      )
      .eq('barcode', barcode)
      .maybeSingle()
    if (cached) {
      return {
        item: {
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
        },
        online: true,
        fromCache: true
      }
    }
  }

  let item: FoodItem | null = null
  let online = false
  try {
    const res = await fetch(`${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`)
    if (res.ok) {
      online = true
      const data = (await res.json()) as { status?: number; product?: unknown }
      if (data.status === 1 && data.product) {
        item = mapOffProduct(data.product as never, 'barcode')
        if (item && !item.barcode) item.barcode = barcode
      }
    }
  } catch {
    // offline — online stays false
  }

  if (item) await cacheFood(item)
  return { item, online, fromCache: false }
}

/**
 * Best-effort per-user barcode cache write (owner_id defaults to auth.uid()).
 * Used by lookupBarcode on OFF hits AND by the Add Food modal when a scanned
 * product OFF doesn't know is entered manually — the next scan is then instant.
 */
export async function cacheFood(item: FoodItem): Promise<void> {
  if (!item.barcode) return
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
