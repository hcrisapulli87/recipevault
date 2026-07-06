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
