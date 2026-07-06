import { describe, it, expect } from 'vitest'
import { ingredientGrams, estimateRecipeMacros } from '../src/shared/macro-estimator'
import type { RecipeIngredient, Per100g } from '../src/shared/types'

function ing(over: Partial<RecipeIngredient>): RecipeIngredient {
  return { position: 0, raw: '', quantity: null, quantityMax: null, unit: null, name: '', ...over }
}
const CHICKEN: Per100g = { calories: 165, protein: 31, carbs: 0, fat: 3.6 }

describe('ingredientGrams', () => {
  it('converts canonical units', () => {
    expect(ingredientGrams(ing({ quantity: 600, unit: 'g' }), null)).toBe(600)
    expect(ingredientGrams(ing({ quantity: 2, unit: 'tbsp' }), null)).toBe(30)
    expect(ingredientGrams(ing({ quantity: 1, unit: 'cup' }), null)).toBe(240)
    expect(ingredientGrams(ing({ quantity: 1, unit: 'lb' }), null)).toBeCloseTo(453.6)
  })
  it('uses the range midpoint', () => {
    expect(ingredientGrams(ing({ quantity: 1, quantityMax: 3, unit: 'tsp' }), null)).toBe(10)
  })
  it('uses typical weights for unit-less counts', () => {
    expect(ingredientGrams(ing({ quantity: 2, name: 'large eggs' }), null)).toBe(100)
    expect(ingredientGrams(ing({ quantity: 1, name: 'brown onion, diced' }), null)).toBe(150)
  })
  it('falls back to the matched staple serving grams, else null', () => {
    expect(ingredientGrams(ing({ quantity: 2, name: 'weetbix' }), 17)).toBe(34)
    expect(ingredientGrams(ing({ quantity: 1, name: 'mystery item' }), null)).toBeNull()
    expect(ingredientGrams(ing({ name: 'salt & pepper' }), null)).toBeNull()
  })
})

describe('estimateRecipeMacros', () => {
  it('sums matched ingredients per serving and counts matches', () => {
    const ings = [
      ing({ quantity: 400, unit: 'g', name: 'chicken thigh' }),
      ing({ name: 'salt & pepper' })
    ]
    const { estimate, detail } = estimateRecipeMacros(ings, 2, [
      { per100g: CHICKEN, servingGrams: null },
      null
    ])
    expect(estimate.calories).toBe(330) // 165 × 4 / 2
    expect(estimate.protein).toBe(62)
    expect(estimate.matched).toBe(1)
    expect(estimate.total).toBe(2)
    expect(estimate.assumedServings).toBe(false)
    expect(detail[0]).toMatchObject({ matched: true, grams: 400 })
    expect(detail[1]).toMatchObject({ matched: false })
  })
  it('assumes 4 servings when unset and flags it', () => {
    const { estimate } = estimateRecipeMacros(
      [ing({ quantity: 400, unit: 'g', name: 'chicken' })],
      null,
      [{ per100g: CHICKEN, servingGrams: null }]
    )
    expect(estimate.calories).toBe(165) // 165 × 4 / 4
    expect(estimate.assumedServings).toBe(true)
  })
  it('does not count an ingredient whose grams are unknown even if matched', () => {
    const { estimate } = estimateRecipeMacros(
      [ing({ quantity: 1, name: 'mystery item' })],
      2,
      [{ per100g: CHICKEN, servingGrams: null }]
    )
    expect(estimate.matched).toBe(0)
    expect(estimate.calories).toBe(0)
  })
})
