import { describe, it, expect } from 'vitest'
import { mapOffProduct } from '../src/shared/nutrition'
import { computeFibre } from '../src/shared/tracker-logic'
import { estimateRecipeMacros } from '../src/shared/macro-estimator'
import type { LogEntry, RecipeIngredient } from '../src/shared/types'

describe('fibre from OpenFoodFacts', () => {
  const base = {
    product_name: 'Wholegrain Oats',
    code: '9300000000001',
    serving_size: '40 g',
    serving_quantity: 40
  }

  it('reads the per-100 g figure and derives the serve from the serving weight', () => {
    const item = mapOffProduct({
      ...base,
      nutriments: {
        'energy-kcal_100g': 370,
        proteins_100g: 12,
        carbohydrates_100g: 58,
        fat_100g: 8,
        fiber_100g: 10,
        'energy-kcal_serving': 148
      }
    })!
    expect(item.per100g?.fibre).toBe(10)
    expect(item.fibre).toBe(4) // 10 g/100 g × 40 g
  })

  it('prefers a printed per-serve figure', () => {
    const item = mapOffProduct({
      ...base,
      nutriments: {
        'energy-kcal_100g': 370,
        proteins_100g: 12,
        carbohydrates_100g: 58,
        fat_100g: 8,
        fiber_100g: 10,
        'energy-kcal_serving': 148,
        fiber_serving: 4.3
      }
    })!
    expect(item.fibre).toBe(4.3)
  })

  it('leaves fibre unknown when OFF has none, rather than 0', () => {
    const item = mapOffProduct({
      product_name: 'Cola',
      code: '1',
      nutriments: {
        'energy-kcal_100g': 42,
        proteins_100g: 0,
        carbohydrates_100g: 10.6,
        fat_100g: 0
      }
    })!
    expect(item.fibre).toBeNull()
    expect(item.per100g?.fibre).toBeNull()
  })

  it('drops an impossible fibre basis like any other impossible value', () => {
    const item = mapOffProduct({
      product_name: 'Typo Bar',
      code: '2',
      nutriments: {
        'energy-kcal_100g': 400,
        proteins_100g: 10,
        carbohydrates_100g: 50,
        fat_100g: 15,
        fiber_100g: 300
      }
    })
    expect(item).toBeNull() // no per-serve fallback, so nothing trustworthy to show
  })
})

describe('computeFibre', () => {
  const e = (baseFibre: number | null, amount = 1): LogEntry => ({
    id: 1,
    mealType: 'lunch',
    name: 'x',
    brand: null,
    amount,
    unit: 'serving',
    baseCalories: 100,
    baseProtein: 0,
    baseCarbs: 0,
    baseFat: 0,
    baseFibre,
    barcode: null,
    source: 'staple'
  })

  it('sums only the entries that carry a figure and says how many did', () => {
    expect(computeFibre([e(3), e(null), e(2, 2)])).toEqual({ total: 7, known: 2, entries: 3 })
  })

  it('reports an empty day as nothing known', () => {
    expect(computeFibre([])).toEqual({ total: 0, known: 0, entries: 0 })
  })
})

describe('recipe fibre estimate', () => {
  const ing = (name: string, quantity: number): RecipeIngredient => ({
    position: 0,
    raw: `${quantity} g ${name}`,
    quantity,
    quantityMax: null,
    unit: 'g',
    name
  })

  it('sums fibre from the ingredients that have it, per serve', () => {
    const { estimate } = estimateRecipeMacros([ing('oats', 200), ing('mystery', 100)], 2, [
      { per100g: { calories: 370, protein: 12, carbs: 58, fat: 8, fibre: 10 }, servingGrams: null },
      { per100g: { calories: 100, protein: 0, carbs: 0, fat: 0, fibre: null }, servingGrams: null }
    ])
    expect(estimate.fibre).toBe(10) // 20 g over 2 serves; the unknown adds nothing
  })

  it('is null when no matched ingredient has a fibre figure', () => {
    const { estimate } = estimateRecipeMacros([ing('mystery', 100)], 1, [
      { per100g: { calories: 100, protein: 0, carbs: 0, fat: 0 }, servingGrams: null }
    ])
    expect(estimate.fibre).toBeNull()
  })
})
