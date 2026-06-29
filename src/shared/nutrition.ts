import type { FoodItem } from '../shared/types'
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
    return {
      name,
      brand,
      barcode,
      servingDesc: p.serving_size ?? null,
      unit: 'serving',
      calories: round0(servingCal ?? 0),
      protein: round1(num(n.proteins_serving) ?? 0),
      carbs: round1(num(n.carbohydrates_serving) ?? 0),
      fat: round1(num(n.fat_serving) ?? 0),
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
