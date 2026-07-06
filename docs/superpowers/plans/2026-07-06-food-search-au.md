# Food Search AU + Barcode-Miss Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Country-relevant (Australia-first), brand-aware food search via a Vercel proxy to OpenFoodFacts Search-a-licious, plus a barcode-miss → "add it once, cached forever" flow.

**Architecture:** New `api/food-search.ts` Vercel function (SaL has no CORS headers; mirrors `api/scrape.ts` conventions) queries AU-filtered first, falls back to world when thin, and normalises results to the legacy `OffProduct` shape via a pure shared module. The client's `searchFoods` calls the proxy; `mapOffProduct` is untouched. `AddFoodModal` gains a barcode-miss path that pre-links the Manual tab to the scanned barcode and writes the result into the existing per-user `food_cache`. Spec: `docs/superpowers/specs/2026-07-06-food-search-au-design.md`.

**Tech Stack:** Vercel Node function, OpenFoodFacts Search-a-licious API, React, vitest.

**Conventions:** Repo root `recipe-vault/`. Branch `feat/food-search-au`. Tests in `tests/`, supabase mocked with the `data-tracker.test.ts` in-memory pattern. Commit per green task.

---

### Task 0: Branch

- [ ] **Step 0.1:** `git checkout -b feat/food-search-au`

---

### Task 1: Pure merge/normalise module (TDD)

**Files:**
- Create: `src/shared/food-search.ts`
- Test: `tests/food-search-merge.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `tests/food-search-merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeSalHit, mergeSearchHits } from '../src/shared/food-search'

describe('normalizeSalHit', () => {
  it('joins the brands array to a comma string and stringifies the code', () => {
    const n = normalizeSalHit({
      product_name: 'Tuna in Oil',
      brands: ['Sirena', 'Simplot'],
      code: 9350177000152,
      nutriments: { 'energy-kcal_100g': 200 }
    })
    expect(n.brands).toBe('Sirena, Simplot')
    expect(n.code).toBe('9350177000152')
    expect(n.nutriments).toEqual({ 'energy-kcal_100g': 200 })
  })
  it('passes string brands through unchanged', () => {
    expect(normalizeSalHit({ product_name: 'X', brands: 'Tip Top' }).brands).toBe('Tip Top')
  })
})

describe('mergeSearchHits', () => {
  it('keeps AU hits first and dedupes world hits by code', () => {
    const au = [{ product_name: 'Tuna in Oil', brands: ['Sirena'], code: '111' }]
    const world = [
      { product_name: 'Tuna in Oil (world dup)', code: '111' },
      { product_name: 'Thon a lhuile', code: '222' }
    ]
    const merged = mergeSearchHits(au, world)
    expect(merged.map((p) => p.code)).toEqual(['111', '222'])
    expect(merged[0].product_name).toBe('Tuna in Oil')
  })
  it('dedupes code-less hits by name and drops empty hits', () => {
    const merged = mergeSearchHits(
      [{ product_name: 'Homemade Soup' }],
      [{ product_name: 'HOMEMADE SOUP' }, { product_name: '' }, {}]
    )
    expect(merged).toHaveLength(1)
  })
})
```

- [ ] **Step 1.2:** Run `npx vitest run tests/food-search-merge.test.ts` — expect FAIL (module missing).

- [ ] **Step 1.3: Implement**

Create `src/shared/food-search.ts`:

```ts
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
```

- [ ] **Step 1.4:** Run `npx vitest run tests/food-search-merge.test.ts` — expect PASS (4 tests).
- [ ] **Step 1.5:** Commit: `git add src/shared/food-search.ts tests/food-search-merge.test.ts && git commit -m "feat(foods): pure SaL normalise/merge module (AU-first, dedupe by code)"`

---

### Task 2: Vercel proxy `api/food-search.ts`

**Files:**
- Create: `api/food-search.ts`

Thin fetch wrapper around the tested module — compiler-verified; live-verified post-deploy.

- [ ] **Step 2.1: Create the function**

Create `api/food-search.ts`:

```ts
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
```

- [ ] **Step 2.2:** `npm run typecheck` — clean (tsconfig.node includes `api/**`).
- [ ] **Step 2.3:** Commit: `git add api/food-search.ts && git commit -m "feat(api): food-search proxy - SaL AU-first with world fallback"`

---

### Task 3: Client `searchFoods` via proxy + `cacheFood` (TDD)

**Files:**
- Modify: `src/renderer/data/foods.ts`
- Test: `tests/data-foods.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Create `tests/data-foods.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { searchFoods, cacheFood } from '../src/renderer/data/foods'
import type { FoodItem } from '../src/shared/types'

const state = vi.hoisted(() => ({
  upserted: [] as { row: Record<string, unknown>; options: Record<string, unknown> }[]
}))

vi.mock('../src/renderer/data/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: (row: Record<string, unknown>, options: Record<string, unknown>) => {
        state.upserted.push({ row, options })
        return Promise.resolve({ error: null })
      },
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) })
    })
  }
}))

function offProduct(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product_name: 'Tuna in Oil',
    brands: 'Sirena',
    code: '9350177000152',
    nutriments: {
      'energy-kcal_100g': 200,
      proteins_100g: 24,
      carbohydrates_100g: 0,
      fat_100g: 11
    },
    ...over
  }
}

beforeEach(() => {
  state.upserted = []
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchFoods', () => {
  it('queries the proxy and merges staples first, deduped by name', async () => {
    let requested = ''
    vi.stubGlobal('fetch', async (url: string) => {
      requested = String(url)
      return {
        ok: true,
        json: async () => ({
          ok: true,
          // First product collides with the bundled "Banana" staple by name.
          products: [offProduct({ product_name: 'Banana' }), offProduct()]
        })
      }
    })
    const results = await searchFoods('banana')
    expect(requested).toContain('/api/food-search?q=banana')
    const bananas = results.filter((r) => r.name.toLowerCase() === 'banana')
    expect(bananas).toHaveLength(1)
    expect(bananas[0].source).toBe('staple') // staple wins the name collision
    expect(results.some((r) => r.name === 'Tuna in Oil' && r.brand === 'Sirena')).toBe(true)
  })

  it('degrades to staples when the proxy is unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    const results = await searchFoods('banana')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.source === 'staple')).toBe(true)
  })
})

describe('cacheFood', () => {
  it('upserts the per-user barcode cache row', async () => {
    const item: FoodItem = {
      name: 'Woolies Choc Milk',
      brand: 'Woolworths',
      barcode: '9300633000001',
      servingDesc: null,
      unit: 'serving',
      calories: 180,
      protein: 8,
      carbs: 24,
      fat: 5,
      source: 'manual'
    }
    await cacheFood(item)
    expect(state.upserted).toEqual([
      {
        row: {
          barcode: '9300633000001',
          name: 'Woolies Choc Milk',
          brand: 'Woolworths',
          serving_desc: null,
          unit: 'serving',
          cal_per_unit: 180,
          protein_per_unit: 8,
          carbs_per_unit: 24,
          fat_per_unit: 5
        },
        options: { onConflict: 'owner_id,barcode' }
      }
    ])
  })

  it('does nothing without a barcode', async () => {
    await cacheFood({
      name: 'X',
      brand: null,
      barcode: null,
      servingDesc: null,
      unit: 'serving',
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
      source: 'manual'
    })
    expect(state.upserted).toHaveLength(0)
  })
})
```

(If the bundled staples list has no "Banana", pick any staple name from
`src/shared/data/common-foods.json` and use it in both the fixture and the query.)

- [ ] **Step 3.2:** Run `npx vitest run tests/data-foods.test.ts` — expect FAIL (`cacheFood` not exported; endpoint mismatch).

- [ ] **Step 3.3: Rework foods.ts**

In `src/renderer/data/foods.ts`:

1. Replace the OFF search block with the proxy call. Replace the module header +
   `searchFoods` with:

```ts
import { supabase } from './supabase'
import { searchStaples, mapOffProduct } from '../../shared/nutrition'
import type { FoodItem } from '../../shared/types'

// Text search goes through our Vercel proxy (api/food-search.ts): OFF's ranked
// Search-a-licious API sends no CORS headers, so the browser can't call it directly.
// DEV → same-origin (the vite dev proxy forwards /api to the deployed origin);
// desktop production → derived from VITE_SCRAPE_URL (same origin, sibling function).
const FOOD_SEARCH_ENDPOINT = import.meta.env.DEV
  ? '/api/food-search'
  : import.meta.env.VITE_SCRAPE_URL
    ? (import.meta.env.VITE_SCRAPE_URL as string).replace(/scrape$/, 'food-search')
    : '/api/food-search'

// Barcode lookups still hit OFF directly — the v2 product endpoint sends ACAO: *
// and isn't the rate-limited search endpoint.
const OFF_BASE = 'https://world.openfoodfacts.org'
const OFF_FIELDS = 'product_name,brands,code,serving_size,serving_quantity,nutriments'

/** Bundled offline staples first, then the AU-first proxy search. Degrades to staples offline. */
export async function searchFoods(query: string): Promise<FoodItem[]> {
  const staples = searchStaples(query)

  let off: FoodItem[] = []
  try {
    const res = await fetch(`${FOOD_SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`)
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; products?: unknown[] }
      if (data.ok) {
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
  return merged.slice(0, 30)
}
```

2. Extract the cache upsert (currently inline at the bottom of `lookupBarcode`)
   into an exported helper, and call it from `lookupBarcode`:

```ts
/** Best-effort per-user barcode cache write (owner_id defaults to auth.uid()). */
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
```

In `lookupBarcode`, replace the trailing `if (item) { await supabase.from('food_cache').upsert(…) }` block with:

```ts
  if (item) await cacheFood(item)
```

- [ ] **Step 3.4:** Run `npx vitest run tests/data-foods.test.ts` — expect PASS (4 tests). Also `npx vitest run` — full suite green.
- [ ] **Step 3.5:** Commit: `git add src/renderer/data/foods.ts tests/data-foods.test.ts && git commit -m "feat(foods): search via AU-first proxy; extract cacheFood helper"`

---

### Task 4: Barcode-miss → add-it-once flow (AddFoodModal)

**Files:**
- Modify: `src/renderer/components/AddFoodModal.tsx`

Compiler + existing suite verified; live-verified post-deploy.

- [ ] **Step 4.1: Wire the flow**

In `src/renderer/components/AddFoodModal.tsx`:

1. Import `cacheFood`:

```ts
import { lookupBarcode, searchFoods, cacheFood } from '../data/foods'
```

2. Add state next to the barcode tab state:

```ts
  // Set when a scan/lookup found no product — carried into the Manual tab so the
  // entry is saved into food_cache and the next scan of it resolves instantly.
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null)
```

3. In `lookUp`, remember misses and clear on hits:

```ts
      const item = await lookupBarcode(trimmed)
      if (!item) {
        setBarcodeError(`No product found for barcode ${trimmed}.`)
        setPendingBarcode(trimmed)
      } else {
        setPendingBarcode(null)
        setSelected(item)
      }
```

4. In `startManual`, attach the pending barcode:

```ts
      barcode: pendingBarcode,
```

5. In `log()`, after `await addLogEntry(entry)` add (best-effort — a cache
   failure must not block the log):

```ts
      if (selected.source === 'manual' && selected.barcode) {
        try {
          await cacheFood(selected)
        } catch {
          // cache is best-effort; the entry itself is already logged
        }
      }
```

6. In the barcode tab, extend the error banner with the hand-off button
   (replace the existing `{barcodeError && …}` line):

```tsx
            {barcodeError && (
              <div className="banner banner--warn">
                <span>{barcodeError}</span>
                {pendingBarcode && (
                  <button className="btn" onClick={() => setTab('manual')}>
                    ✏️ Add it manually — saves for next scan
                  </button>
                )}
              </div>
            )}
```

7. In the manual tab, surface (and allow detaching) the pending barcode — insert
   directly under the `{tab === 'manual' && (<>` opening:

```tsx
            {pendingBarcode && (
              <div className="banner banner--ok">
                <span>
                  Will be saved for barcode <strong>{pendingBarcode}</strong> — next scan is
                  instant.
                </span>
                <button className="btn" onClick={() => setPendingBarcode(null)}>
                  Detach
                </button>
              </div>
            )}
```

- [ ] **Step 4.2:** `npm run typecheck` && `npx vitest run` — clean/green.
- [ ] **Step 4.3:** Commit: `git add src/renderer/components/AddFoodModal.tsx && git commit -m "feat(tracker): barcode-miss -> manual add cached for next scan"`

---

### Task 5: README, verification, finish

**Files:**
- Modify: `README.md`

- [ ] **Step 5.1:** In README's "What it does", update the macro-tracker bullet to mention Australia-first search and the own-cache barcode flow (match existing tone):

```markdown
- **Macro tracker** — per-day food log (search a bundled staples list + OpenFoodFacts
  ranked Australia-first via `api/food-search.ts` — brands work as plain text, e.g.
  "tip top bread" — scan a barcode with the camera, or enter manually; a product the
  database doesn't know can be added once and is cached per-user for future scans)
  with daily calorie/protein/carb/fat goals.
```

- [ ] **Step 5.2:** Full verification: `npm run typecheck`, `npx vitest run`, `npm run lint` (0 errors), `npm run build:web`, `npx electron-vite build`.
- [ ] **Step 5.3:** Commit README, then finishing-a-development-branch: ff-merge → main, plain push (no schema step this time — the push itself deploys the new function).
- [ ] **Step 5.4: Post-deploy live verification** (the function only exists once Vercel deploys):

```
curl "https://recipevault-kappa.vercel.app/api/food-search?q=tuna%20in%20oil"   → Sirena/John West first
curl "https://recipevault-kappa.vercel.app/api/food-search?q=tip%20top%20bread" → Tip Top loaves first
```

---

## Hand-off after implementation

Harrison verifies in the app: tracker → Add food → search "tuna in oil" (expect
Australian brands), "tip top bread" (expect Tip Top), and a barcode-miss manual
add (scan something obscure, add it, rescan — instant).
