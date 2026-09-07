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

/** Generic AU foods (relevance-ranked, offline) first, then AU-first branded
 *  OpenFoodFacts hits beneath them. Degrades to generics-only when OFF is down. */
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

  // Dedupe by barcode when present (globally unique), else name+brand: a branded
  // OFF product that happens to share a generic's name ("Banana · Some Brand") is
  // a different food with its own barcode/serving and must not be swallowed. The
  // unified key also closes the old client/proxy key mismatch that let branded
  // duplicates slip through.
  const foodKey = (f: FoodItem): string =>
    f.barcode ? `bc:${f.barcode}` : `${f.name.toLowerCase()}|${(f.brand ?? '').toLowerCase()}`
  const seen = new Set(staples.map(foodKey))
  const merged = [...staples]
  for (const item of off) {
    const k = foodKey(item)
    if (!seen.has(k)) {
      merged.push(item)
      seen.add(k)
    }
  }
  // Generics are already capped in searchStaples; a roomy overall cap keeps
  // branded products visible below them.
  return { items: merged.slice(0, 40), online }
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
        'barcode, name, brand, serving_desc, unit, cal_per_unit, protein_per_unit, carbs_per_unit, fat_per_unit, cal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, serving_grams'
      )
      .eq('barcode', barcode)
      .maybeSingle()
    if (cached) {
      // Restore the per-100 g basis and serving weight so a re-scan keeps the
      // grams⇄serving picker. Rows cached before those columns existed have neither,
      // and fall back to the serve-only flow exactly as before.
      const per100g =
        cached.cal_per_100g !== null && cached.cal_per_100g !== undefined
          ? {
              calories: cached.cal_per_100g,
              protein: cached.protein_per_100g ?? 0,
              carbs: cached.carbs_per_100g ?? 0,
              fat: cached.fat_per_100g ?? 0
            }
          : undefined
      const grams = cached.serving_grams
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
          source: 'barcode',
          per100g,
          measures:
            grams !== null && grams !== undefined && grams > 0
              ? [{ desc: cached.serving_desc || `${Math.round(grams)} g`, grams }]
              : []
        },
        online: true,
        fromCache: true
      }
    }
  }

  let item: FoodItem | null = null
  let online = false
  try {
    const res = await fetch(
      `${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`
    )
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
 * The user's most recently logged foods, deduped by name+brand — shown in the
 * Add Food modal before a search is typed, so everyday items are one tap
 * instead of a network search. Own entries only (recents are personal).
 */
export async function getRecentFoods(limit = 8): Promise<FoodItem[]> {
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) return []

  // Over-fetch (recent days repeat the same foods heavily), dedupe client-side.
  const { data, error } = await supabase
    .from('food_log')
    .select('name, brand, unit, base_calories, base_protein, base_carbs, base_fat, barcode, source')
    .eq('owner_id', user.id)
    .order('id', { ascending: false })
    .limit(100)
  if (error || !data) return []

  const seen = new Set<string>()
  const out: FoodItem[] = []
  for (const r of data) {
    const key = `${r.name.toLowerCase()}|${(r.brand ?? '').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    // 100 g entries carry a per-100 g basis, so recents re-logged from them keep
    // the grams⇄serving flexibility (new logs are stored as 100 g).
    const per100g =
      r.unit === '100g'
        ? {
            calories: r.base_calories,
            protein: r.base_protein,
            carbs: r.base_carbs,
            fat: r.base_fat
          }
        : undefined
    out.push({
      name: r.name,
      brand: r.brand,
      barcode: r.barcode,
      servingDesc: r.unit === '100g' ? 'per 100 g' : null,
      unit: r.unit,
      calories: r.base_calories,
      protein: r.base_protein,
      carbs: r.base_carbs,
      fat: r.base_fat,
      source: 'recent',
      per100g
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Best-effort per-user barcode cache write (owner_id defaults to auth.uid()).
 * Used by lookupBarcode on OFF hits AND by the Add Food modal when a scanned
 * product OFF doesn't know is entered manually — the next scan is then instant.
 */
export async function cacheFood(item: FoodItem): Promise<void> {
  if (!item.barcode) return
  // The per-100 g basis and the serving weight are cached alongside the per-unit macros;
  // without them a re-scan came back as a serve-only item and lost the grams⇄serving
  // picker the first scan offered.
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
      fat_per_unit: item.fat,
      cal_per_100g: item.per100g?.calories ?? null,
      protein_per_100g: item.per100g?.protein ?? null,
      carbs_per_100g: item.per100g?.carbs ?? null,
      fat_per_100g: item.per100g?.fat ?? null,
      serving_grams: item.measures?.[0]?.grams ?? null
    },
    { onConflict: 'owner_id,barcode' }
  )
}
