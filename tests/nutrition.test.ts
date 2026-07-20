import { describe, it, expect } from 'vitest'
import { mapOffProduct, searchStaples } from '../src/shared/nutrition'

describe('mapOffProduct', () => {
  it('prefers per-serving macros when OpenFoodFacts supplies them', () => {
    const product = {
      product_name: 'Greek Yogurt',
      brands: 'Fage, Total',
      code: '5000159407236',
      serving_size: '170 g',
      serving_quantity: 170,
      nutriments: {
        'energy-kcal_100g': 59,
        proteins_100g: 10,
        carbohydrates_100g: 3.6,
        fat_100g: 0.4,
        'energy-kcal_serving': 100,
        proteins_serving: 17,
        carbohydrates_serving: 6,
        fat_serving: 0.7
      }
    }
    expect(mapOffProduct(product, 'barcode')).toEqual({
      name: 'Greek Yogurt',
      brand: 'Fage',
      barcode: '5000159407236',
      servingDesc: '170 g',
      unit: 'serving',
      calories: 100,
      protein: 17,
      carbs: 6,
      fat: 0.7,
      source: 'barcode',
      // Canonical per-100 g basis + serving measure enable the grams⇄serving picker.
      per100g: { calories: 59, protein: 10, carbs: 3.6, fat: 0.4 },
      measures: [{ desc: '170 g', grams: 170 }]
    })
  })

  it('falls back to per-100 g when there is no serving info', () => {
    const item = mapOffProduct({
      product_name: 'Olive Oil',
      code: 123,
      nutriments: {
        'energy-kcal_100g': 884,
        proteins_100g: 0,
        carbohydrates_100g: 0,
        fat_100g: 100
      }
    })
    expect(item).toMatchObject({
      name: 'Olive Oil',
      barcode: '123',
      unit: '100g',
      servingDesc: 'per 100 g',
      calories: 884,
      fat: 100,
      source: 'search'
    })
  })

  it('derives missing per-serving macros from per-100 g data instead of zeroing them', () => {
    // OFF often has serving calories but not serving protein/carbs/fat. With a
    // numeric serving_quantity we can scale the per-100 g values rather than log 0.
    const item = mapOffProduct({
      product_name: 'Protein Pudding',
      serving_size: '200 g',
      serving_quantity: 200,
      nutriments: {
        'energy-kcal_100g': 80,
        proteins_100g: 10,
        carbohydrates_100g: 5.2,
        fat_100g: 1.5,
        'energy-kcal_serving': 160
      }
    })
    expect(item).toMatchObject({
      unit: 'serving',
      calories: 160,
      protein: 20, // 10 g/100g × 200 g
      carbs: 10.4,
      fat: 3
    })
  })

  it('returns null when the product has no name or no usable macros', () => {
    expect(mapOffProduct({ nutriments: { 'energy-kcal_100g': 100 } })).toBeNull()
    expect(mapOffProduct({ product_name: 'Mystery' })).toBeNull()
    expect(mapOffProduct({ product_name: 'Empty', nutriments: {} })).toBeNull()
  })
})

describe('searchStaples (AU generic foods)', () => {
  it('finds generics by substring, on a per-100 g basis', () => {
    const results = searchStaples('chicken')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.source === 'staple' && r.unit === '100g')).toBe(true)
    expect(results.every((r) => r.per100g && r.calories === r.per100g.calories)).toBe(true)
    expect(results.some((r) => r.name.toLowerCase().includes('chicken'))).toBe(true)
  })

  it('ranks a head-name hit above a deep substring match', () => {
    // "Pasta, …" must beat "…with pasta…" — this is the fix for "pasta → branded junk".
    const top = searchStaples('pasta')[0]
    expect(top.name.toLowerCase().startsWith('pasta')).toBe(true)
  })

  it('carries real serving measures for common foods (grams fallback otherwise)', () => {
    const pasta = searchStaples('pasta').find((r) => /boiled/i.test(r.name))
    expect(pasta?.measures?.length).toBeGreaterThan(0)
    expect(pasta?.measures?.every((m) => m.grams > 0 && m.desc)).toBe(true)
  })

  it('returns nothing for an empty query', () => {
    expect(searchStaples('')).toEqual([])
    expect(searchStaples('   ')).toEqual([])
  })
})
