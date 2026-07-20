import type { FoodItem, FoodMeasure, Per100g } from './types'
import auFoodsData from './data/au-foods.json'

// Generic (non-branded) foods come from the FSANZ Australian Food Composition
// Database (AFCD Release 3.0, CC BY) — bundled offline as au-foods.json, built
// by scripts/build-au-foods.mjs. Each record's macros are per 100 g; `measures`
// (when present) are real AU household serving sizes.
interface AuFood {
  key: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  measures?: FoodMeasure[]
}

const AU_FOODS = auFoodsData as AuFood[]

const round0 = (n: number): number => Math.round(n)
const round1 = (n: number): number => Math.round(n * 10) / 10

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Crude depluraliser applied to BOTH sides of a match, so consistency matters
// more than English correctness ("thighs"→"thigh"; "couscous"→"couscou" on both sides).
function normFood(s: string): string {
  return s.toLowerCase().replace(/(\w{3,}?)s\b/g, '$1')
}

/** The comma-prefix "head" of an AFCD name — "Pasta, white wheat flour, boiled" → "pasta". */
function headOf(name: string): string {
  return name.toLowerCase().split(',')[0].trim()
}

function auToFoodItem(f: AuFood): FoodItem {
  const per100g: Per100g = {
    calories: f.calories,
    protein: f.protein,
    carbs: f.carbs,
    fat: f.fat
  }
  return {
    name: f.name,
    brand: null,
    barcode: null,
    servingDesc: 'per 100 g',
    unit: '100g',
    calories: f.calories,
    protein: f.protein,
    carbs: f.carbs,
    fat: f.fat,
    source: 'staple',
    per100g,
    measures: f.measures ?? []
  }
}

/**
 * Relevance rank of an AFCD food for a query (lower = better). Generic whole
 * foods should beat verbose composite names: an exact/prefix hit on the head
 * name ("Pasta, …" for "pasta") ranks far above a deep substring match
 * ("…with pasta…"). Ties break on the shorter (usually more generic) name.
 */
function rankScore(nameLower: string, head: string, headN: string, q: string, qn: string): number {
  if (head === q) return 0
  if (headN === qn) return 1
  if (head.startsWith(q)) return 2
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(nameLower)) return 3
  if (head.includes(q)) return 4
  return 5 // substring somewhere in the tail
}

/**
 * Relevance-ranked search over the bundled AU generic-food database. Returns
 * enriched FoodItems (per-100 g basis + real serving measures). This is the
 * generic layer that ranks ABOVE branded OpenFoodFacts hits in the Add flow.
 */
export function searchStaples(query: string): FoodItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const qn = normFood(q)
  // Match on ALL query words, not the exact phrase: "chicken breast" must find
  // "Chicken, breast, baked" (AFCD puts a comma between them). The phrase is still
  // used for head-name ranking below, so an exact "Pasta, …" hit still wins.
  const tokens = q.split(/\s+/).filter(Boolean)

  const scored: { f: AuFood; score: number }[] = []
  for (const f of AU_FOODS) {
    const nameLower = f.name.toLowerCase()
    if (!tokens.every((t) => nameLower.includes(t))) continue
    const head = headOf(f.name)
    scored.push({ f, score: rankScore(nameLower, head, normFood(head), q, qn) })
  }
  // Same relevance → prefer foods with real serving sizes (these are the curated
  // everyday forms — cooked rice/pasta, raw banana, fluid milk — so they beat
  // odd forms like "dry"/"powder"/"frozen"), then the shorter/more generic name.
  const hasMeasures = (f: AuFood): number => (f.measures && f.measures.length ? 0 : 1)
  scored.sort(
    (a, b) =>
      a.score - b.score || hasMeasures(a.f) - hasMeasures(b.f) || a.f.name.length - b.f.name.length
  )
  return scored.slice(0, 25).map((s) => auToFoodItem(s.f))
}

/** Per-100 g lookup for the recipe macro estimator: the shortest generic whose
 *  head name contains — or is contained by — the ingredient ("chicken thighs" →
 *  "Chicken, thigh, …"). */
export function staplePer100g(name: string): { per100g: Per100g; servingGrams: number | null } | null {
  const q = normFood(name.trim())
  if (!q) return null
  const hits = AU_FOODS.filter((f) => {
    const n = normFood(headOf(f.name))
    return n.includes(q) || q.includes(n)
  }).sort((a, b) => a.name.length - b.name.length)
  const f = hits[0]
  if (!f) return null
  return {
    per100g: { calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat },
    servingGrams: f.measures?.[0]?.grams ?? null
  }
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
 * unit-tested against a saved JSON fixture. Populates a per-100 g basis and, when
 * OFF gives a serving weight, a serving measure — so branded items get the same
 * grams⇄serving flexibility as generics. Prefers per-serving macros for the flat
 * display fields when OFF supplies them, otherwise falls back to per-100 g.
 * Returns null for products with no usable name or macros.
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
  const grams = num(p.serving_quantity)

  if (cal100 === null && pro100 === null && carb100 === null && fat100 === null && !hasServing) {
    return null
  }

  const brand = p.brands ? p.brands.split(',')[0].trim() : null
  const barcode = p.code !== undefined && p.code !== '' ? String(p.code) : null

  // OFF data is often partial: serving calories present but serving macros
  // missing. Derive those from per-100 g scaled by serving_quantity (grams)
  // rather than silently logging them as 0.
  const perServing = (serving: number | null, per100: number | null): number =>
    serving ?? (per100 !== null && grams !== null ? (per100 * grams) / 100 : 0)

  // Canonical per-100 g basis — from the per-100 g fields when present, else
  // back-derived from the serving values and weight.
  let per100g: Per100g | undefined
  if (cal100 !== null || pro100 !== null || carb100 !== null || fat100 !== null) {
    per100g = {
      calories: round0(cal100 ?? 0),
      protein: round1(pro100 ?? 0),
      carbs: round1(carb100 ?? 0),
      fat: round1(fat100 ?? 0)
    }
  } else if (hasServing && grams !== null && grams > 0) {
    const to100 = (v: number): number => (v * 100) / grams
    per100g = {
      calories: round0(to100(servingCal ?? 0)),
      protein: round1(to100(perServing(num(n.proteins_serving), null))),
      carbs: round1(to100(perServing(num(n.carbohydrates_serving), null))),
      fat: round1(to100(perServing(num(n.fat_serving), null)))
    }
  }

  const measures: FoodMeasure[] =
    grams !== null && grams > 0 ? [{ desc: p.serving_size?.trim() || `${round0(grams)} g`, grams }] : []

  if (hasServing) {
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
      source,
      per100g,
      measures
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
    source,
    per100g,
    measures
  }
}
