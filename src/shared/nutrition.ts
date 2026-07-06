import type { FoodItem, Per100g } from './types'
import staplesData from './data/common-foods.json'

// OpenFoodFacts asks every client to send an identifying User-Agent.
const USER_AGENT = 'RecipeVault/1.0 (personal meal tracker)'
const OFF_BASE = 'https://world.openfoodfacts.org'
const OFF_FIELDS = 'product_name,brands,code,serving_size,serving_quantity,nutriments'

interface Staple {
  name: string
  serving: { desc: string; grams: number }
  per100g: { calories: number; protein: number; carbs: number; fat: number }
}

const STAPLES = staplesData as Staple[]

const round0 = (n: number): number => Math.round(n)
const round1 = (n: number): number => Math.round(n * 10) / 10

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function stapleToFoodItem(s: Staple): FoodItem {
  const f = s.serving.grams / 100
  return {
    name: s.name,
    brand: null,
    barcode: null,
    servingDesc: s.serving.desc,
    unit: 'serving',
    calories: round0(s.per100g.calories * f),
    protein: round1(s.per100g.protein * f),
    carbs: round1(s.per100g.carbs * f),
    fat: round1(s.per100g.fat * f),
    source: 'staple'
  }
}

/** Substring search over the bundled offline staples list. */
export function searchStaples(query: string): FoodItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return STAPLES.filter((s) => s.name.toLowerCase().includes(q)).map(stapleToFoodItem)
}

// Crude depluraliser applied to BOTH sides of the match, so consistency matters
// more than English correctness ("thighs"→"thigh"; "couscous"→"couscou" on both sides).
function normFood(s: string): string {
  return s.toLowerCase().replace(/(\w{3,}?)s\b/g, '$1')
}

/** Per-100g staple lookup for the macro estimator: shortest staple whose pre-comma
 *  name contains — or is contained by — the query ("chicken thighs" → "Chicken thigh, cooked"). */
export function staplePer100g(name: string): { per100g: Per100g; servingGrams: number } | null {
  const q = normFood(name.trim())
  if (!q) return null
  const hits = STAPLES.filter((s) => {
    const n = normFood(s.name.split(',')[0])
    return n.includes(q) || q.includes(n)
  }).sort((a, b) => a.name.length - b.name.length)
  return hits[0] ? { per100g: hits[0].per100g, servingGrams: hits[0].serving.grams } : null
}

interface OffNutriments {
  'energy-kcal_100g'?: number | string
  proteins_100g?: number | string
  carbohydrates_100g?: number | string
  fat_100g?: number | string
  'energy-kcal_serving'?: number | string
  proteins_serving?: number | string
  carbohydrates_serving?: number | string
  fat_serving?: number | string
}

interface OffProduct {
  product_name?: string
  brands?: string
  code?: string | number
  serving_size?: string
  serving_quantity?: number | string
  nutriments?: OffNutriments
}

/**
 * Map an OpenFoodFacts product to a FoodItem. Pure (no network) so it can be
 * unit-tested against a saved JSON fixture. Prefers per-serving macros when OFF
 * supplies them, otherwise falls back to per-100 g. Returns null for products
 * with no usable name or macros.
 */
export function mapOffProduct(
  p: OffProduct,
  source: 'search' | 'barcode' = 'search'
): FoodItem | null {
  const name = (p.product_name ?? '').trim()
  const n = p.nutriments
  if (!name || !n) return null

  const cal100 = num(n['energy-kcal_100g'])
  const pro100 = num(n.proteins_100g)
  const carb100 = num(n.carbohydrates_100g)
  const fat100 = num(n.fat_100g)

  const servingCal = num(n['energy-kcal_serving'])
  const hasServing = servingCal !== null && !!p.serving_size

  if (cal100 === null && pro100 === null && carb100 === null && fat100 === null && !hasServing) {
    return null
  }

  const brand = p.brands ? p.brands.split(',')[0].trim() : null
  const barcode = p.code !== undefined && p.code !== '' ? String(p.code) : null

  if (hasServing) {
    // OFF data is often partial: serving calories present but serving macros missing.
    // Derive those from the per-100 g values scaled by serving_quantity (grams) rather
    // than silently logging them as 0.
    const grams = num(p.serving_quantity)
    const perServing = (serving: number | null, per100: number | null): number =>
      serving ?? (per100 !== null && grams !== null ? (per100 * grams) / 100 : 0)
    return {
      name,
      brand,
      barcode,
      servingDesc: p.serving_size ?? null,
      unit: 'serving',
      calories: round0(servingCal ?? 0),
      protein: round1(perServing(num(n.proteins_serving), pro100)),
      carbs: round1(perServing(num(n.carbohydrates_serving), carb100)),
      fat: round1(perServing(num(n.fat_serving), fat100)),
      source
    }
  }

  return {
    name,
    brand,
    barcode,
    servingDesc: 'per 100 g',
    unit: '100g',
    calories: round0(cal100 ?? 0),
    protein: round1(pro100 ?? 0),
    carbs: round1(carb100 ?? 0),
    fat: round1(fat100 ?? 0),
    source
  }
}

/** Bundled staples first (clean whole-food data), then OpenFoodFacts text search. */
export async function searchFoods(query: string): Promise<FoodItem[]> {
  const staples = searchStaples(query)

  let off: FoodItem[] = []
  try {
    const url =
      `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
      `&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (res.ok) {
      const data = (await res.json()) as { products?: OffProduct[] }
      off = (data.products ?? [])
        .map((p) => mapOffProduct(p, 'search'))
        .filter((x): x is FoodItem => x !== null)
    }
  } catch {
    // Network failure: staples are still returned so the feature degrades gracefully.
  }

  const seen = new Set(staples.map((s) => s.name.toLowerCase()))
  const merged = [...staples]
  for (const item of off) {
    const key = item.name.toLowerCase()
    if (!seen.has(key)) {
      merged.push(item)
      seen.add(key)
    }
  }
  return merged.slice(0, 30)
}

/** Look up a single product by barcode via OpenFoodFacts. */
export async function lookupBarcode(barcode: string): Promise<FoodItem | null> {
  const url = `${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) return null
  const data = (await res.json()) as { status?: number; product?: OffProduct }
  if (data.status !== 1 || !data.product) return null
  const item = mapOffProduct(data.product, 'barcode')
  if (item && !item.barcode) item.barcode = barcode
  return item
}
