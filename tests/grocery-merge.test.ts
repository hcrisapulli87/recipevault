import { describe, it, expect } from 'vitest'
import { mergeIngredients, groceryTitle, normaliseName } from '../src/main/grocery-merge'
import { parseIngredient } from '../src/shared/ingredient-parser'

describe('mergeIngredients', () => {
  it('sums quantities with matching units', () => {
    const merged = mergeIngredients([parseIngredient('2 onions'), parseIngredient('1 onion')])
    expect(merged).toHaveLength(1)
    expect(merged[0].parts).toEqual([{ quantity: 3, unit: null }])
  })

  it('keeps mismatched units as separate parts of one item', () => {
    const merged = mergeIngredients([parseIngredient('200g flour'), parseIngredient('1 cup flour')])
    expect(merged).toHaveLength(1)
    expect(merged[0].parts).toHaveLength(2)
  })

  it('keeps distinct ingredients separate', () => {
    const merged = mergeIngredients([parseIngredient('2 onions'), parseIngredient('3 carrots')])
    expect(merged).toHaveLength(2)
  })

  it('passes through unparseable lines with no parts', () => {
    const merged = mergeIngredients([parseIngredient('salt and pepper to taste')])
    expect(merged[0]).toEqual({ name: 'salt and pepper to taste', parts: [] })
  })

  it('keeps the first-seen display name', () => {
    const merged = mergeIngredients([parseIngredient('2 Onions'), parseIngredient('1 onion')])
    expect(merged[0].name).toBe('Onions')
  })
})

describe('groceryTitle', () => {
  it('formats single part', () =>
    expect(groceryTitle({ name: 'onion', parts: [{ quantity: 3, unit: null }] })).toBe('Onion (3)'))

  it('formats multiple parts', () =>
    expect(
      groceryTitle({
        name: 'flour',
        parts: [
          { quantity: 200, unit: 'g' },
          { quantity: 1, unit: 'cup' }
        ]
      })
    ).toBe('Flour (200 g + 1 cup)'))

  it('formats no parts as just the name', () =>
    expect(groceryTitle({ name: 'salt to taste', parts: [] })).toBe('Salt to taste'))

  it('uses fractions', () =>
    expect(groceryTitle({ name: 'cream', parts: [{ quantity: 0.5, unit: 'cup' }] })).toBe(
      'Cream (½ cup)'
    ))
})

describe('normaliseName', () => {
  it('matches singular and plural', () =>
    expect(normaliseName('Onions ')).toBe(normaliseName('onion')))

  it('does not over-strip short words', () => expect(normaliseName('gas')).toBe('gas'))

  it('extracts the name part of a grocery title', () =>
    expect(normaliseName('Onions (3)')).toBe(normaliseName('onion')))
})
