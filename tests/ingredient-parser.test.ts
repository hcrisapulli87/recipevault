import { describe, it, expect } from 'vitest'
import { parseIngredient, scaleIngredient, formatQuantity } from '../src/shared/ingredient-parser'

describe('parseIngredient', () => {
  it('parses qty + unit + name', () =>
    expect(parseIngredient('2 cups flour')).toEqual({
      raw: '2 cups flour',
      quantity: 2,
      quantityMax: null,
      unit: 'cup',
      name: 'flour'
    }))

  it('parses metric with no space', () =>
    expect(parseIngredient('400g chopped tomatoes')).toMatchObject({
      quantity: 400,
      unit: 'g',
      name: 'chopped tomatoes'
    }))

  it('parses unicode fraction', () =>
    expect(parseIngredient('½ onion, diced')).toMatchObject({
      quantity: 0.5,
      unit: null,
      name: 'onion, diced'
    }))

  it('parses mixed number', () =>
    expect(parseIngredient('1 ½ tbsp olive oil')).toMatchObject({
      quantity: 1.5,
      unit: 'tbsp',
      name: 'olive oil'
    }))

  it('parses range', () =>
    expect(parseIngredient('1-2 cloves garlic')).toMatchObject({
      quantity: 1,
      quantityMax: 2,
      unit: 'clove',
      name: 'garlic'
    }))

  it('handles unitless count', () =>
    expect(parseIngredient('3 eggs')).toMatchObject({ quantity: 3, unit: null, name: 'eggs' }))

  it('strips "of" after unit', () =>
    expect(parseIngredient('2 cans of chopped tomatoes')).toMatchObject({
      unit: 'can',
      name: 'chopped tomatoes'
    }))

  it('parses multiplied pack quantities ("2 x 400g tins")', () =>
    expect(parseIngredient('2 x 400g tins plum tomatoes')).toMatchObject({
      quantity: 800,
      unit: 'g',
      name: 'plum tomatoes'
    }))

  it('parses multiplied counts without inner unit ("2 x 400g" style with bare unit)', () =>
    expect(parseIngredient('3 x 2 eggs')).toMatchObject({ quantity: 6, name: 'eggs' }))

  it('returns null quantity when unparseable', () =>
    expect(parseIngredient('salt and pepper to taste')).toMatchObject({
      quantity: null,
      quantityMax: null,
      unit: null,
      name: 'salt and pepper to taste'
    }))

  it('does not treat a non-unit word as a unit', () =>
    expect(parseIngredient('2 red onions')).toMatchObject({
      quantity: 2,
      unit: null,
      name: 'red onions'
    }))
})

describe('scaleIngredient', () => {
  it('scales linearly', () =>
    expect(scaleIngredient(parseIngredient('2 cups flour'), 1.5).quantity).toBe(3))

  it('scales ranges', () =>
    expect(scaleIngredient(parseIngredient('1-2 cloves garlic'), 2)).toMatchObject({
      quantity: 2,
      quantityMax: 4
    }))

  it('leaves unparseable lines alone', () => {
    const ing = parseIngredient('salt to taste')
    expect(scaleIngredient(ing, 3)).toEqual(ing)
  })
})

describe('formatQuantity', () => {
  it('formats whole numbers plainly', () => {
    expect(formatQuantity(3)).toBe('3')
    expect(formatQuantity(400)).toBe('400')
  })
  it('formats nice fractions', () => {
    expect(formatQuantity(0.5)).toBe('½')
    expect(formatQuantity(0.25)).toBe('¼')
    expect(formatQuantity(1.5)).toBe('1 ½')
    expect(formatQuantity(0.33)).toBe('⅓')
    expect(formatQuantity(2 / 3)).toBe('⅔')
  })
  it('falls back to decimals for odd values', () => expect(formatQuantity(0.4)).toBe('0.4'))
})
