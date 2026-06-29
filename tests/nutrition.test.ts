import { describe, it, expect } from 'vitest'
import { mapOffProduct, searchStaples } from '../src/main/nutrition'

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
      source: 'barcode'
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

  it('returns null when the product has no name or no usable macros', () => {
    expect(mapOffProduct({ nutriments: { 'energy-kcal_100g': 100 } })).toBeNull()
    expect(mapOffProduct({ product_name: 'Mystery' })).toBeNull()
    expect(mapOffProduct({ product_name: 'Empty', nutriments: {} })).toBeNull()
  })
})

describe('searchStaples', () => {
  it('finds staples by substring, scaled to their serving', () => {
    const results = searchStaples('chicken')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.source === 'staple' && r.unit === 'serving')).toBe(true)
    expect(results.some((r) => r.name.toLowerCase().includes('chicken'))).toBe(true)
  })

  it('scales per-100 g data to the serving size', () => {
    // Banana: 118 g serving, 89 kcal/100 g -> 89 * 1.18 = 105 kcal
    const banana = searchStaples('banana')[0]
    expect(banana.calories).toBe(105)
  })

  it('returns nothing for an empty query', () => {
    expect(searchStaples('')).toEqual([])
    expect(searchStaples('   ')).toEqual([])
  })
})
