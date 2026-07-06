import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeRecipeEstimate, saveRecipeEstimate } from '../src/renderer/data/macroEstimate'
import type { Recipe } from '../src/shared/types'

const state = vi.hoisted(() => ({
  updated: [] as { patch: Record<string, unknown>; id: number }[]
}))
vi.mock('../src/renderer/data/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_c: string, id: number) => {
          state.updated.push({ patch, id })
          return Promise.resolve({ error: null })
        }
      })
    })
  }
}))

function recipe(ingredients: Recipe['ingredients'], servings: number | null): Recipe {
  return {
    id: 1,
    ownerId: 'u',
    title: 'T',
    sourceUrl: null,
    imageUrl: null,
    description: '',
    servings,
    prepMin: null,
    cookMin: null,
    totalMin: null,
    createdAt: '',
    est: null,
    ingredients,
    steps: []
  }
}
const ing = (
  name: string,
  quantity: number | null,
  unit: string | null
): Recipe['ingredients'][number] => ({
  position: 0,
  raw: '',
  quantity,
  quantityMax: null,
  unit,
  name
})

beforeEach(() => {
  state.updated = []
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('computeRecipeEstimate', () => {
  it('matches staples offline without any fetch (plural + comma-suffix tolerant)', async () => {
    let fetches = 0
    vi.stubGlobal('fetch', async () => {
      fetches++
      throw new Error('offline')
    })
    // Bundled staple is "Chicken thigh, cooked" — the query is plural, no suffix.
    const r = recipe([ing('chicken thighs', 600, 'g')], 2)
    const { estimate } = await computeRecipeEstimate(r)
    expect(estimate.matched).toBe(1)
    expect(estimate.calories).toBeGreaterThan(0)
    expect(fetches).toBe(0)
  })
  it('falls back to the proxy per-100g nutriments', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        products: [
          { nutriments: {} }, // first hit unusable → skipped
          {
            nutriments: {
              'energy-kcal_100g': 90,
              proteins_100g: 4,
              carbohydrates_100g: 12,
              fat_100g: 2
            }
          }
        ]
      })
    }))
    const r = recipe([ing('xylophone berries', 200, 'g')], 2)
    const { estimate } = await computeRecipeEstimate(r)
    expect(estimate.matched).toBe(1)
    expect(estimate.calories).toBe(90) // 90 × 2 / 2
  })
  it('marks unmatched when nothing knows the ingredient', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ ok: true, products: [] })
    }))
    const { estimate } = await computeRecipeEstimate(recipe([ing('xylophone berries', 1, null)], 2))
    expect(estimate.matched).toBe(0)
  })
})

describe('saveRecipeEstimate', () => {
  it('writes the summary columns', async () => {
    await saveRecipeEstimate(7, {
      calories: 620,
      protein: 42,
      carbs: 58,
      fat: 18,
      matched: 10,
      total: 12,
      assumedServings: false
    })
    expect(state.updated).toHaveLength(1)
    expect(state.updated[0].id).toBe(7)
    expect(state.updated[0].patch).toMatchObject({
      est_cal_serve: 620,
      est_protein_serve: 42,
      est_carbs_serve: 58,
      est_fat_serve: 18,
      est_matched: 10,
      est_total: 12
    })
    expect(typeof state.updated[0].patch.est_computed_at).toBe('string')
  })
})
