// Pure normalisation/merge logic for the food-search Vercel proxy — kept out of
// the handler so it can be unit-tested without network or Vercel plumbing.

/** A hit as Search-a-licious returns it (brands is an ARRAY, unlike the legacy API). */
export interface SalHit {
  product_name?: string
  brands?: string[] | string
  code?: string | number
  serving_size?: string
  serving_quantity?: number | string
  nutriments?: Record<string, number | string>
}

/** The legacy OffProduct shape the client's mapOffProduct already understands. */
export interface NormalizedProduct {
  product_name?: string
  brands?: string
  code?: string
  serving_size?: string
  serving_quantity?: number | string
  nutriments?: Record<string, number | string>
}

/** When the AU-filtered search returns fewer hits than this, the world search runs too. */
export const AU_FALLBACK_THRESHOLD = 8

export function normalizeSalHit(h: SalHit): NormalizedProduct {
  return {
    product_name: h.product_name,
    brands: Array.isArray(h.brands) ? h.brands.join(', ') : h.brands,
    code: h.code !== undefined && h.code !== '' ? String(h.code) : undefined,
    serving_size: h.serving_size,
    serving_quantity: h.serving_quantity,
    nutriments: h.nutriments
  }
}

/** AU hits first, world hits appended, deduped by barcode — or by name when code-less. */
export function mergeSearchHits(au: SalHit[], world: SalHit[]): NormalizedProduct[] {
  const out: NormalizedProduct[] = []
  const seen = new Set<string>()
  for (const h of [...au, ...world]) {
    const n = normalizeSalHit(h)
    const key = n.code ?? (n.product_name ?? '').toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}
