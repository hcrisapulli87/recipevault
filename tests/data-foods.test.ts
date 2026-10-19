import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  searchFoods,
  cacheFood,
  lookupBarcode,
  getRecentFoods,
  clearFoodSearchCache
} from '../src/renderer/data/foods'
import type { FoodItem } from '../src/shared/types'

const state = vi.hoisted(() => ({
  upserted: [] as { row: Record<string, unknown>; options: Record<string, unknown> }[],
  cachedRow: null as Record<string, unknown> | null,
  cacheQueried: [] as string[][],
  logRows: [] as Record<string, unknown>[]
}))

vi.mock('../src/renderer/data/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({
      upsert: (row: Record<string, unknown>, options: Record<string, unknown>) => {
        state.upserted.push({ row, options })
        return Promise.resolve({ error: null })
      },
      select: () => ({
        in: (_col: string, values: string[]) => {
          state.cacheQueried.push(values)
          return Promise.resolve({ data: state.cachedRow ? [state.cachedRow] : [] })
        },
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: state.cachedRow }),
          order: () => ({
            limit: () => Promise.resolve({ data: state.logRows, error: null })
          })
        })
      })
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
  state.cachedRow = null
  state.cacheQueried = []
  state.logRows = []
  clearFoodSearchCache()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchFoods', () => {
  it('ranks AU generics first, branded OFF hits below, deduped by barcode', async () => {
    let requested = ''
    vi.stubGlobal('fetch', async (url: string) => {
      requested = String(url)
      return {
        ok: true,
        json: async () => ({
          ok: true,
          products: [
            offProduct({ product_name: 'Banana Bread', code: '111' }),
            // Same barcode twice — the duplicate must collapse.
            offProduct({ product_name: 'Banana Smoothie', code: '222' }),
            offProduct({ product_name: 'Banana Smoothie (dup)', code: '222' })
          ]
        })
      }
    })
    const { items, online } = await searchFoods('banana')
    expect(requested).toContain('/api/food-search?q=banana')
    expect(online).toBe(true)

    // Generics (bundled AU foods, source 'staple') come first; branded 'search'
    // hits appear only after them.
    const firstBranded = items.findIndex((r) => r.source === 'search')
    expect(firstBranded).toBeGreaterThan(0)
    expect(items.slice(0, firstBranded).every((r) => r.source === 'staple')).toBe(true)
    expect(items.some((r) => r.name.toLowerCase().startsWith('banana'))).toBe(true)

    // Barcode 222 appeared twice upstream but survives once.
    expect(items.filter((r) => r.barcode === '222')).toHaveLength(1)
  })

  it('degrades to staples and reports online:false when the proxy is unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    const { items, online } = await searchFoods('banana')
    expect(online).toBe(false)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((r) => r.source === 'staple')).toBe(true)
  })

  it('reports online:false when the proxy answers ok:false (upstream search down)', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ ok: false, message: 'Food search is unavailable right now.' })
    }))
    const { items, online } = await searchFoods('banana')
    expect(online).toBe(false)
    expect(items.every((r) => r.source === 'staple')).toBe(true)
  })
})

describe('lookupBarcode', () => {
  const CACHE_ROW = {
    barcode: '9350177000152',
    name: 'Tuna in Oil',
    brand: 'Sirena',
    serving_desc: null,
    unit: '100g',
    cal_per_unit: 200,
    protein_per_unit: 24,
    carbs_per_unit: 0,
    fat_per_unit: 11
  }

  it('returns the cached item without hitting OFF', async () => {
    state.cachedRow = CACHE_ROW
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { item, online, fromCache } = await lookupBarcode('9350177000152')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(fromCache).toBe(true)
    expect(online).toBe(true)
    expect(item?.name).toBe('Tuna in Oil')
  })

  it('restores the per-100 g basis and serving measure from the cache', async () => {
    state.cachedRow = {
      ...CACHE_ROW,
      serving_desc: '95g',
      cal_per_100g: 200,
      protein_per_100g: 24,
      carbs_per_100g: 0,
      fat_per_100g: 11,
      serving_grams: 95
    }
    vi.stubGlobal('fetch', vi.fn())
    const { item } = await lookupBarcode('9350177000152')
    expect(item?.per100g).toEqual({ calories: 200, protein: 24, carbs: 0, fat: 11, fibre: null })
    expect(item?.measures).toEqual([{ desc: '95g', grams: 95 }])
  })

  it('re-checks OpenFoodFacts when the cached row has gone stale', async () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
    state.cachedRow = { ...CACHE_ROW, last_fetched: old }
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ status: 1, product: offProduct({ product_name: 'Tuna in Oil (2026)' }) })
    }))
    const { item, fromCache } = await lookupBarcode('9350177000152')
    expect(item?.name).toBe('Tuna in Oil (2026)')
    expect(fromCache).toBe(false)
    // Re-cached with a fresh timestamp, or the row could never leave the stale path.
    expect(Date.parse(state.upserted[0].row.last_fetched as string)).toBeGreaterThan(
      Date.parse(old)
    )
  })

  it('keeps serving a stale row when the re-check cannot be done', async () => {
    state.cachedRow = {
      ...CACHE_ROW,
      last_fetched: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
    }
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    const { item, online, fromCache } = await lookupBarcode('9350177000152')
    expect(item?.name).toBe('Tuna in Oil') // the stale row, not a failed scan
    expect(fromCache).toBe(true)
    expect(online).toBe(true)
  })

  it('serves a recent cache row without re-checking', async () => {
    state.cachedRow = { ...CACHE_ROW, last_fetched: new Date().toISOString() }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { fromCache } = await lookupBarcode('9350177000152')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(fromCache).toBe(true)
  })

  it('leaves pre-migration cache rows on the serve-only basis', async () => {
    state.cachedRow = CACHE_ROW // no per-100 g columns
    vi.stubGlobal('fetch', vi.fn())
    const { item } = await lookupBarcode('9350177000152')
    expect(item?.per100g).toBeUndefined()
    expect(item?.measures).toEqual([])
  })

  it('skipCache bypasses the cache, fetches OFF fresh and re-caches', async () => {
    state.cachedRow = CACHE_ROW
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ status: 1, product: offProduct({ product_name: 'Tuna in Oil (fresh)' }) })
    }))
    const { item, online, fromCache } = await lookupBarcode('9350177000152', { skipCache: true })
    expect(fromCache).toBe(false)
    expect(online).toBe(true)
    expect(item?.name).toBe('Tuna in Oil (fresh)')
    expect(state.upserted).toHaveLength(1) // fresh result re-cached
  })

  it('distinguishes a genuine not-found (online:true) from OFF unreachable (online:false)', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ status: 0 })
    }))
    const notFound = await lookupBarcode('4000000000000')
    expect(notFound.item).toBeNull()
    expect(notFound.online).toBe(true)

    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    const offline = await lookupBarcode('4000000000000')
    expect(offline.item).toBeNull()
    expect(offline.online).toBe(false)
  })
})

describe('lookupBarcode — equivalent codes and partial products', () => {
  it('finds a UPC-A product OFF files under its EAN-13 spelling', async () => {
    const requested: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(String(url))
      const found = String(url).includes('/0036000291452.json')
      return {
        ok: found,
        status: found ? 200 : 404,
        json: async () => (found ? { status: 1, product: offProduct({ code: '0036000291452' }) } : { status: 0 })
      }
    })
    const { item, online } = await lookupBarcode('036000291452')
    expect(online).toBe(true)
    expect(item?.name).toBe('Tuna in Oil')
    expect(requested).toHaveLength(2)
    // The cache is searched under every spelling too.
    expect(state.cacheQueried[0]).toEqual(['036000291452', '0036000291452'])
  })

  it('treats OFF’s HTTP 404 as a genuine not-found, not as offline', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({ status: 0 }) }))
    const { item, online } = await lookupBarcode('5449000000996')
    expect(item).toBeNull()
    expect(online).toBe(true)
  })

  it('stops after the first unreachable call instead of retrying every spelling', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const { online } = await lookupBarcode('036000291452')
    expect(online).toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('reports the name of a known product that has no nutrition', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 1,
        product: { product_name: 'Tim Tam Original', brands: "Arnott's, Campbell", nutriments: {} }
      })
    }))
    const { item, online, known } = await lookupBarcode('9310072000268')
    expect(item).toBeNull()
    expect(online).toBe(true)
    expect(known).toEqual({ name: 'Tim Tam Original', brand: "Arnott's" })
  })
})

describe('searchFoods — ranking and session cache', () => {
  it('puts products that name the query above ones that merely mention it', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        products: [
          offProduct({ product_name: 'Cat Food Ocean Mix', brands: 'Whiskas', code: '1' }),
          offProduct({ product_name: 'Tuna Chunks in Springwater', brands: 'John West', code: '2' })
        ]
      })
    }))
    const { items } = await searchFoods('tuna')
    const packaged = items.filter((r) => r.source === 'search')
    expect(packaged.map((r) => r.barcode)).toEqual(['2', '1'])
  })

  it('serves a repeated search from the session cache', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, products: [offProduct()] })
    }))
    vi.stubGlobal('fetch', fetchSpy)
    await searchFoods('tuna')
    const again = await searchFoods('  Tuna ')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(again.online).toBe(true)
    expect(again.items.some((r) => r.source === 'search')).toBe(true)
  })

  it('never caches a failed search', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('offline')
    })
    vi.stubGlobal('fetch', fetchSpy)
    await searchFoods('tuna')
    await searchFoods('tuna')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

describe('getRecentFoods', () => {
  const logRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    name: 'Greek Yogurt',
    brand: 'Chobani',
    unit: 'serving',
    base_calories: 140,
    base_protein: 15,
    base_carbs: 8,
    base_fat: 4,
    barcode: null,
    source: 'search',
    ...over
  })

  it('dedupes repeat logs by name+brand and maps rows to FoodItems', async () => {
    state.logRows = [
      logRow(),
      logRow(), // yesterday's identical log — must collapse
      logRow({ name: 'Greek Yogurt', brand: null }), // same name, no brand → distinct
      logRow({ name: 'Oats', brand: null, unit: '100g', base_calories: 389 })
    ]
    const recents = await getRecentFoods()
    expect(recents).toHaveLength(3)
    expect(recents[0]).toMatchObject({
      name: 'Greek Yogurt',
      brand: 'Chobani',
      calories: 140,
      source: 'recent'
    })
    expect(recents[2]).toMatchObject({ name: 'Oats', unit: '100g', servingDesc: 'per 100 g' })
  })

  it('caps the list at the requested limit', async () => {
    state.logRows = Array.from({ length: 20 }, (_, i) => logRow({ name: `Food ${i}` }))
    const recents = await getRecentFoods(8)
    expect(recents).toHaveLength(8)
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
    expect(state.upserted).toHaveLength(1)
    const { last_fetched, ...row } = state.upserted[0].row
    expect(row).toEqual({
      barcode: '9300633000001',
      name: 'Woolies Choc Milk',
      brand: 'Woolworths',
      serving_desc: null,
      unit: 'serving',
      cal_per_unit: 180,
      protein_per_unit: 8,
      carbs_per_unit: 24,
      fat_per_unit: 5,
      fibre_per_unit: null,
      cal_per_100g: null,
      protein_per_100g: null,
      carbs_per_100g: null,
      fat_per_100g: null,
      fibre_per_100g: null,
      serving_grams: null
    })
    expect(state.upserted[0].options).toEqual({ onConflict: 'owner_id,barcode' })
    // Written explicitly — the column default only fires on INSERT, so an upsert over an
    // existing row would otherwise keep its original timestamp forever.
    expect(Date.parse(last_fetched as string)).toBeGreaterThan(Date.now() - 60_000)
  })

  it('caches the per-100 g basis and serving weight so a re-scan stays flexible', async () => {
    await cacheFood({
      name: 'Vegemite',
      brand: 'Vegemite',
      barcode: '9352042000298',
      servingDesc: '5g',
      unit: 'serving',
      calories: 11,
      protein: 1.2,
      carbs: 0.9,
      fat: 0,
      source: 'barcode',
      per100g: { calories: 216, protein: 24.5, carbs: 18.2, fat: 0.4 },
      measures: [{ desc: '5g', grams: 5 }]
    })
    expect(state.upserted[0].row).toMatchObject({
      cal_per_100g: 216,
      protein_per_100g: 24.5,
      carbs_per_100g: 18.2,
      fat_per_100g: 0.4,
      serving_grams: 5
    })
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
