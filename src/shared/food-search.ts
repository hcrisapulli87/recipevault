// Pure normalisation/merge logic for the food-search Vercel proxy — kept out of
// the handler so it can be unit-tested without network or Vercel plumbing.
import type { FoodItem } from './types'

/** A hit as Search-a-licious returns it (brands is an ARRAY, unlike the legacy API). */
export interface SalHit {
  product_name?: string
  product_name_en?: string
  generic_name_en?: string
  generic_name?: string
  brands?: string[] | string
  code?: string | number
  serving_size?: string
  serving_quantity?: number | string
  serving_quantity_unit?: string
  nutriments?: Record<string, number | string>
}

/** The legacy OffProduct shape the client's mapOffProduct already understands. */
export interface NormalizedProduct {
  product_name?: string
  product_name_en?: string
  generic_name_en?: string
  generic_name?: string
  brands?: string
  code?: string
  serving_size?: string
  serving_quantity?: number | string
  serving_quantity_unit?: string
  nutriments?: Record<string, number | string>
}

/** The OFF product fields mapOffProduct reads — requested by both the search proxy and
 *  the barcode lookup so neither silently drops the name fallbacks. Lives here, not in
 *  nutrition.ts, so the serverless function doesn't bundle the AFCD table. */
export const OFF_PRODUCT_FIELDS =
  'product_name,product_name_en,generic_name_en,generic_name,brands,code,serving_size,serving_quantity,serving_quantity_unit,nutriments'

/** When the AU-filtered search returns fewer hits than this, the world search runs too. */
export const AU_FALLBACK_THRESHOLD = 8

export function normalizeSalHit(h: SalHit): NormalizedProduct {
  return {
    product_name: h.product_name,
    product_name_en: h.product_name_en,
    generic_name_en: h.generic_name_en,
    generic_name: h.generic_name,
    brands: Array.isArray(h.brands) ? h.brands.join(', ') : h.brands,
    code: h.code !== undefined && h.code !== '' ? String(h.code) : undefined,
    serving_size: h.serving_size,
    serving_quantity: h.serving_quantity,
    // Requested from upstream all along but dropped here, so every drink in the search
    // results was labelled in grams ("250 g") even though OFF said ml.
    serving_quantity_unit: h.serving_quantity_unit,
    nutriments: h.nutriments
  }
}

/**
 * URL for the legacy OpenFoodFacts search (cgi/search.pl). Kept as the fallback
 * source: Search-a-licious has better ranking but has proven to go hard-down
 * (502s for days), while the legacy endpoint stays up, if flaky. Its products
 * already use the legacy shape (brands as a comma string), so results feed
 * straight into mergeSearchHits.
 */
export function legacySearchUrl(
  q: string,
  opts: { fields: string; pageSize: number; australia?: boolean }
): string {
  let url =
    'https://world.openfoodfacts.org/cgi/search.pl' +
    `?search_terms=${encodeURIComponent(q)}` +
    '&search_simple=1&action=process&json=1' +
    `&page_size=${opts.pageSize}&fields=${opts.fields}`
  if (opts.australia) {
    url += '&tagtype_0=countries&tag_contains_0=contains&tag_0=australia'
  }
  return url
}

/** AU hits first, world hits appended, deduped by barcode — or by name when code-less. */
export function mergeSearchHits(au: SalHit[], world: SalHit[]): NormalizedProduct[] {
  const out: NormalizedProduct[] = []
  const seen = new Set<string>()
  for (const h of [...au, ...world]) {
    const n = normalizeSalHit(h)
    const key = n.code ?? (n.product_name || n.product_name_en || n.generic_name || '').toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}

/**
 * Make free text safe for Search-a-licious' Lucene-style parser. Brackets, quotes and
 * field syntax ("coke (zero)", "50% dark", "m&m's: peanut") made it return zero hits —
 * the handler notes a parenthesised query always comes back empty — which forced every
 * such search onto the slow, unranked legacy fallback. Upper-case AND/OR/NOT are
 * operators to the parser, so they are lower-cased into plain words.
 */
export function sanitizeSearchQuery(q: string): string {
  return q
    .replace(/[()[\]{}:"'^~*?\\/!+|&<>=%-]/g, ' ')
    .replace(/\b(AND|OR|NOT)\b/g, (w) => w.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
}

/** Lower-cased words with a light plural strip, for matching query ⇄ product text. */
function matchWords(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
}

/**
 * Re-rank branded results so the products the query actually names come first.
 * Upstream relevance also matches on categories and ingredient lists, so "milk" led
 * with milk chocolate and "tuna" with a cat food that lists it; and incomplete rows
 * (no per-100 g basis, so no grams option) sat above complete ones. Stable: within a
 * tier the upstream order (AU first, then relevance) is kept.
 *
 * Tiers: every query word in the name/brand → some of them → none; then products with
 * a per-100 g basis before serve-only ones.
 */
export function rankPackagedResults(query: string, items: FoodItem[]): FoodItem[] {
  const qWords = matchWords(query)
  if (qWords.length === 0) return items
  const score = (f: FoodItem): number => {
    const words = matchWords(`${f.name} ${f.brand ?? ''}`)
    const hit = (w: string): boolean => words.some((x) => x === w || x.startsWith(w))
    const missing = qWords.filter((w) => !hit(w)).length
    const tier = missing === 0 ? 0 : missing < qWords.length ? 1 : 2
    return tier * 10 + (f.per100g ? 0 : 1)
  }
  return items
    .map((f, i) => ({ f, i, s: score(f) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.f)
}
