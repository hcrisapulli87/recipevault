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
    const { items, online } = await searchFoods('banana')
    expect(requested).toContain('/api/food-search?q=banana')
    expect(online).toBe(true)
    const bananas = items.filter((r) => r.name.toLowerCase() === 'banana')
    expect(bananas).toHaveLength(1)
    expect(bananas[0].source).toBe('staple') // staple wins the name collision
    expect(items.some((r) => r.name === 'Tuna in Oil' && r.brand === 'Sirena')).toBe(true)
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
