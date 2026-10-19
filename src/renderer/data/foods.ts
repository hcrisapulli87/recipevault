import { supabase } from './supabase'
import { searchStaples, mapOffProduct, offProductIdentity } from '../../shared/nutrition'
import { barcodeCandidates } from '../../shared/barcode'
import { OFF_PRODUCT_FIELDS, rankPackagedResults } from '../../shared/food-search'
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
/** A hung OpenFoodFacts request used to leave "Looking it up…" on screen forever. */
const OFF_TIMEOUT_MS = 8_000

export interface FoodSearchResult {
  items: FoodItem[]
  /** False when the online product search failed (offline, or OpenFoodFacts down)
   *  and only the bundled staples could be searched — the UI says so instead of
   *  presenting a misleading "no matches". */
  online: boolean
}

/** Successful online results, per normalised query, for this session. Going Back from
 *  the confirm step and re-running the same search (or retyping it) was a fresh
 *  network round trip every time. Failures are never cached, so a retry still retries. */
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000
const SEARCH_CACHE_MAX = 30
const searchCache = new Map<string, { at: number; items: FoodItem[] }>()

/** Test hook — module state otherwise leaks between test cases. */
export function clearFoodSearchCache(): void {
  searchCache.clear()
}

async function searchOnline(query: string): Promise<FoodItem[] | null> {
  const key = query.toLowerCase().replace(/\s+/g, ' ')
  const hit = searchCache.get(key)
  if (hit && Date.now() - hit.at < SEARCH_CACHE_TTL_MS) return hit.items
  try {
    const res = await fetch(`${FOOD_SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`)
    if (!res.ok) return null
    const data = (await res.json()) as { ok?: boolean; products?: unknown[] }
    if (!data.ok) return null
    const items = rankPackagedResults(
      query,
      (data.products ?? [])
        .map((p) => mapOffProduct(p as never, 'search'))
        .filter((x): x is FoodItem => x !== null)
    )
    searchCache.delete(key)
    searchCache.set(key, { at: Date.now(), items })
    // Map iteration is insertion-ordered, so the first key is the oldest.
    if (searchCache.size > SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value!)
    return items
  } catch {
    return null // offline — staples still returned
  }
}

/** Generic AU foods (relevance-ranked, offline) first, then AU-first branded
 *  OpenFoodFacts hits beneath them — re-ranked so products the query actually names
 *  lead. Degrades to generics-only when OFF is down. */
export async function searchFoods(query: string): Promise<FoodSearchResult> {
  const staples = searchStaples(query)
  const fetched = await searchOnline(query.trim())
  const online = fetched !== null
  const off = fetched ?? []

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

/** How long a cached barcode row is trusted without re-checking OpenFoodFacts. */
const CACHE_TTL_DAYS = 90

function isFresh(lastFetched: string | null | undefined): boolean {
  if (!lastFetched) return true // pre-migration rows carry no timestamp; don't churn them
  const t = Date.parse(lastFetched)
  if (Number.isNaN(t)) return true
  return Date.now() - t < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000
}

export interface BarcodeLookupResult {
  item: FoodItem | null
  /** False when OpenFoodFacts couldn't be reached — "couldn't check" is not
   *  "not found", and the UI must not offer to cache a manual entry for a
   *  barcode OFF may actually know. */
  online: boolean
  /** True when the item came from the per-user food_cache rather than OFF. */
  fromCache: boolean
  /** OFF knows the product's name but has no usable nutrition for it — lets the UI
   *  pre-fill the manual entry instead of starting from a blank form. */
  known?: { name: string; brand: string | null } | null
}

const CACHE_COLS =
  'owner_id, barcode, name, brand, serving_desc, unit, cal_per_unit, protein_per_unit, carbs_per_unit, fat_per_unit, fibre_per_unit, cal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fibre_per_100g, serving_grams, last_fetched'

interface CacheRow {
  owner_id?: string
  barcode: string
  name: string
  brand: string | null
  serving_desc: string | null
  unit: string
  cal_per_unit: number
  protein_per_unit: number
  carbs_per_unit: number
  fat_per_unit: number
  fibre_per_unit?: number | null
  cal_per_100g?: number | null
  protein_per_100g?: number | null
  carbs_per_100g?: number | null
  fat_per_100g?: number | null
  fibre_per_100g?: number | null
  serving_grams?: number | null
  last_fetched?: string | null
}

function cacheRowToItem(cached: CacheRow): FoodItem {
  // Restore the per-100 g basis and serving weight so a re-scan keeps the
  // grams⇄serving picker. Rows cached before those columns existed have neither,
  // and fall back to the serve-only flow exactly as before.
  const per100g =
    cached.cal_per_100g !== null && cached.cal_per_100g !== undefined
      ? {
          calories: cached.cal_per_100g,
          protein: cached.protein_per_100g ?? 0,
          carbs: cached.carbs_per_100g ?? 0,
          fat: cached.fat_per_100g ?? 0,
          fibre: cached.fibre_per_100g ?? null
        }
      : undefined
  const grams = cached.serving_grams
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
    fibre: cached.fibre_per_unit ?? null,
    source: 'barcode',
    per100g,
    measures:
      grams !== null && grams !== undefined && grams > 0
        ? [{ desc: cached.serving_desc || `${Math.round(grams)} g`, grams }]
        : []
  }
}

/** One OFF product fetch. 'down' = unreachable / errored / timed out. */
async function fetchOffProduct(
  code: string
): Promise<{ status: 'found'; product: unknown } | { status: 'missing' } | { status: 'down' }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${OFF_BASE}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_PRODUCT_FIELDS}`,
      { signal: controller.signal }
    )
    // OFF answers an unknown barcode with HTTP 404 + status 0 — that's a real answer.
    if (!res.ok && res.status !== 404) return { status: 'down' }
    const data = (await res.json()) as { status?: number; product?: unknown }
    return data.status === 1 && data.product
      ? { status: 'found', product: data.product }
      : { status: 'missing' }
  } catch {
    return { status: 'down' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Which cached row answers a scan. The cache is shared across the household (your
 * partner's scan saves you the lookup), so a barcode can have a row from each of you:
 * your own wins, then the freshest of anyone else's. The most literal barcode spelling
 * still beats an equivalent one, whoever cached it.
 */
export function pickCachedRow<
  T extends { owner_id?: string; barcode: string; last_fetched?: string | null }
>(rows: T[], candidates: string[], meId: string | null): T | null {
  for (const code of candidates) {
    const forCode = rows.filter((r) => r.barcode === code)
    if (forCode.length === 0) continue
    const mine = forCode.find((r) => meId !== null && r.owner_id === meId)
    if (mine) return mine
    return [...forCode].sort((a, b) =>
      (b.last_fetched ?? '').localeCompare(a.last_fetched ?? '')
    )[0]
  }
  return null
}

/** Look up a barcode: household cache first (mine, then my partner's), then OpenFoodFacts (and cache the result).
 *  `skipCache` forces a fresh OFF fetch — the escape hatch for stale/typo'd cache rows.
 *
 *  Every equivalent spelling of the code is tried (UPC-A ⇄ EAN-13, UPC-E → UPC-A, see
 *  shared/barcode.ts): OFF files each product under one form, and the scanner may hand
 *  back another. */
export async function lookupBarcode(
  barcode: string,
  opts: { skipCache?: boolean } = {}
): Promise<BarcodeLookupResult> {
  const candidates = barcodeCandidates(barcode)
  if (candidates.length === 0) return { item: null, online: true, fromCache: false }

  // A cached row older than this is served only as a fallback: products get reformulated
  // and OFF entries get corrected, and `last_fetched` was previously written and never
  // read, so a row cached once was authoritative forever. The refresh is silent and
  // strictly safe — if OFF is unreachable or no longer knows the barcode, the stale row
  // is still returned rather than failing the scan.
  let stale: FoodItem | null = null

  if (!opts.skipCache) {
    const [{ data }, { data: auth }] = await Promise.all([
      supabase.from('food_cache').select(CACHE_COLS).in('barcode', candidates),
      supabase.auth.getUser()
    ])
    const cached = pickCachedRow((data ?? []) as CacheRow[], candidates, auth.user?.id ?? null)
    if (cached) {
      const item = cacheRowToItem(cached)
      if (isFresh(cached.last_fetched)) return { item, online: true, fromCache: true }
      stale = item // fall through to OFF, but keep this if the refresh can't be done
    }
  }

  let item: FoodItem | null = null
  let online = false
  let known: { name: string; brand: string | null } | null = null
  for (const code of candidates) {
    const r = await fetchOffProduct(code)
    // Unreachable — stop rather than retrying every variant against a dead server.
    if (r.status === 'down') break
    online = true
    if (r.status === 'missing') continue
    const product = r.product as never
    item = mapOffProduct(product, 'barcode')
    if (item) {
      if (!item.barcode) item.barcode = code
      break
    }
    // Known product, no usable nutrition — remember its name, keep trying variants.
    known ??= offProductIdentity(product)
  }

  if (item) {
    await cacheFood(item)
    return { item, online, fromCache: false }
  }
  // The refresh found nothing (OFF unreachable, or it has since dropped the product).
  // The stale row is better than a failed scan, and `online: true` keeps the UI from
  // claiming we couldn't check.
  if (stale) return { item: stale, online: true, fromCache: true }
  return { item: null, online, fromCache: false, known }
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
    .select(
      'name, brand, unit, base_calories, base_protein, base_carbs, base_fat, base_fibre, barcode, source'
    )
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
            fat: r.base_fat,
            fibre: r.base_fibre ?? null
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
      fibre: r.base_fibre ?? null,
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
      fibre_per_unit: item.fibre ?? null,
      cal_per_100g: item.per100g?.calories ?? null,
      protein_per_100g: item.per100g?.protein ?? null,
      carbs_per_100g: item.per100g?.carbs ?? null,
      fat_per_100g: item.per100g?.fat ?? null,
      fibre_per_100g: item.per100g?.fibre ?? null,
      serving_grams: item.measures?.[0]?.grams ?? null,
      // Set explicitly: the column default only fires on INSERT, so an upsert over an
      // existing row would leave the original timestamp and the row could never come
      // back from stale.
      last_fetched: new Date().toISOString()
    },
    { onConflict: 'owner_id,barcode' }
  )
}
