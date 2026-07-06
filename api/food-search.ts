// Vercel Node serverless function: GET /api/food-search?q=… →
// { ok:true, products } | { ok:false, message }.
// Proxies OpenFoodFacts Search-a-licious (search.openfoodfacts.org): it has the
// best ranking + free-text brand matching, but sends no CORS headers, so the
// browser can't call it directly. Australia-filtered first; when AU coverage is
// thin the world search fills in below. Results are normalised to the legacy
// OffProduct shape the client's mapOffProduct already understands.
import { mergeSearchHits, AU_FALLBACK_THRESHOLD } from '../src/shared/food-search'
import type { SalHit } from '../src/shared/food-search'

const SAL_BASE = 'https://search.openfoodfacts.org/search'
const FIELDS = 'product_name,brands,code,serving_size,serving_quantity,nutriments'
const UA = 'RecipeVault/1.0 (personal meal tracker)'
const TIMEOUT_MS = 10_000
const COUNTRY = 'en:australia'

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
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
}

async function salSearch(q: string): Promise<SalHit[]> {
  const url = `${SAL_BASE}?q=${encodeURIComponent(q)}&langs=en&page_size=20&fields=${FIELDS}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA }
    })
    if (!res.ok) return []
    const data = (await res.json()) as { hits?: SalHit[] }
    return data.hits ?? []
  } finally {
    clearTimeout(timer)
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

  try {
    const au = await salSearch(`${q} countries_tags:"${COUNTRY}"`)
    const world = au.length < AU_FALLBACK_THRESHOLD ? await salSearch(q) : []
    res.status(200).json({ ok: true, products: mergeSearchHits(au, world) })
  } catch (e) {
    console.error('food-search error:', e)
    res.status(200).json({ ok: false, message: 'Food search is unavailable right now.' })
  }
}
