// Vercel Node serverless function: GET /api/food-search?q=… →
// { ok:true, products } | { ok:false, message }.
//
// Source chain (OpenFoodFacts has repeatedly gone down in pieces, so no single
// endpoint is trusted):
//   1. Search-a-licious (search.openfoodfacts.org) — best ranking + free-text
//      brand matching, AU-filtered first with a world fill-in. No CORS headers,
//      hence this proxy.
//   2. Legacy search (world.openfoodfacts.org/cgi/search.pl) — used when
//      Search-a-licious errors OR returns zero hits. It's flaky (intermittent
//      503s) so failed calls are retried, up to 6 attempts within the budget.
// Only when every source fails does the response become ok:false, so the client
// can tell "search is down" apart from "no such food". Successful non-empty
// responses are CDN-cached, which also serves repeat queries during outages.
// Results are normalised to the legacy OffProduct shape the client's
// mapOffProduct already understands.
import { mergeSearchHits, legacySearchUrl, AU_FALLBACK_THRESHOLD } from '../src/shared/food-search'
import type { SalHit, NormalizedProduct } from '../src/shared/food-search'

const SAL_BASE = 'https://search.openfoodfacts.org/search'
const FIELDS =
  'product_name,brands,code,serving_size,serving_quantity,serving_quantity_unit,nutriments'
const PAGE_SIZE = 20
const UA = 'RecipeVault/1.0 (personal meal tracker)'
const COUNTRY = 'en:australia'

// vercel.json raises this function's maxDuration to 30 s; every upstream call
// shares this budget so the fallback chain can never blow past it. The healthy
// path answers in ~1 s — the budget only gets eaten when OFF hangs mid-outage,
// where more retries are exactly what rides it out.
const BUDGET_MS = 25_000
const CALL_TIMEOUT_MS = 4_000
const LEGACY_RETRY_DELAY_MS = 300

// Same allowlist as api/scrape.ts (one env var for all our functions); 'null' is
// the Electron desktop build (file:// pages report the literal Origin "null").
const ALLOWED_ORIGINS = (process.env.SCRAPE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .concat('null')

interface ApiRequest {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  query?: Record<string, string | string[]>
}
interface ApiResponse {
  setHeader(name: string, value: string): void
  status(code: number): ApiResponse
  json(body: unknown): void
  end(): void
}

function setCors(req: ApiRequest, res: ApiResponse): void {
  const origin = req.headers?.origin
  if (typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  // The ACAO header varies per caller, so any cache layer must key on Origin.
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
}

/** GET url as JSON within the remaining time budget; throws on HTTP errors. */
async function fetchJson(url: string, deadline: number): Promise<unknown> {
  const remaining = deadline - Date.now()
  if (remaining < 1_000) throw new Error('time budget exhausted')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(CALL_TIMEOUT_MS, remaining))
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA }
    })
    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function salSearch(q: string, deadline: number): Promise<SalHit[]> {
  const url = `${SAL_BASE}?q=${encodeURIComponent(q)}&langs=en&page_size=${PAGE_SIZE}&fields=${FIELDS}`
  const data = (await fetchJson(url, deadline)) as { hits?: SalHit[] }
  return data.hits ?? []
}

/** Legacy cgi search. The endpoint 503s intermittently (~2 in 3 requests during
 *  OFF incidents) but failures come back fast, so retry up to 6 attempts while
 *  the time budget holds. */
async function legacySearch(q: string, australia: boolean, deadline: number): Promise<SalHit[]> {
  const url = legacySearchUrl(q, { fields: FIELDS, pageSize: PAGE_SIZE, australia })
  for (let attempt = 1; ; attempt++) {
    try {
      const data = (await fetchJson(url, deadline)) as { products?: SalHit[] }
      return data.products ?? []
    } catch (e) {
      if (attempt >= 6 || deadline - Date.now() < 2_000) throw e
      await new Promise((r) => setTimeout(r, LEGACY_RETRY_DELAY_MS))
    }
  }
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const q = typeof req.query?.q === 'string' ? req.query.q.trim() : ''
  if (!q) {
    res.status(400).json({ ok: false, message: 'Missing ?q= parameter.' })
    return
  }

  const deadline = Date.now() + BUDGET_MS
  const respond = (products: NormalizedProduct[]): void => {
    if (products.length > 0) {
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    }
    res.status(200).json({ ok: true, products })
  }

  // Primary: Search-a-licious. The country clause is juxtaposed, NOT joined with an
  // explicit AND and NOT wrapped in parentheses: Search-a-licious' parser returns zero
  // hits for any parenthesised query, and zero for "<multi word> AND field:value" too.
  // The old `(${q}) AND countries_tags:…` form therefore always came back empty, so the
  // AU filter never applied and every search silently fell through to the world results
  // (a search for "milk" led with Thai and Irish products). Plain juxtaposition still
  // filters — "milk" alone returns ~19k hits, with the clause ~2.7k.
  let salProducts: NormalizedProduct[] | null = null
  try {
    const au = await salSearch(`${q} countries_tags:"${COUNTRY}"`, deadline)
    const world = au.length < AU_FALLBACK_THRESHOLD ? await salSearch(q, deadline) : []
    salProducts = mergeSearchHits(au, world)
  } catch (e) {
    console.warn('food-search: Search-a-licious failed:', e)
  }
  if (salProducts && salProducts.length > 0) {
    respond(salProducts)
    return
  }

  // Fallback: legacy search, AU-filtered first, world fill-in best-effort.
  // If the AU-filtered call exhausts its retries, a plain world search is the
  // last resort — unranked results beat none.
  try {
    let au: SalHit[] = []
    let world: SalHit[] = []
    try {
      au = await legacySearch(q, true, deadline)
      if (au.length < AU_FALLBACK_THRESHOLD) {
        world = await legacySearch(q, false, deadline).catch(() => [])
      }
    } catch {
      world = await legacySearch(q, false, deadline)
    }
    respond(mergeSearchHits(au, world))
    return
  } catch (e) {
    console.error('food-search: legacy fallback failed:', e)
  }

  if (salProducts !== null) {
    // Search-a-licious answered (genuinely no matches); legacy being down
    // shouldn't turn that into an error.
    respond(salProducts)
    return
  }
  res.status(200).json({
    ok: false,
    message: 'Food search is unavailable right now (OpenFoodFacts is down). Try again shortly.'
  })
}
