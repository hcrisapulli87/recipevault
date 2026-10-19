import { describe, it, expect } from 'vitest'
import { ingredientKeys, ingredientsForStep } from '../src/shared/step-ingredients'
import { parseIngredient } from '../src/shared/ingredient-parser'
import type { RecipeIngredient } from '../src/shared/types'

const ings = (...lines: string[]): RecipeIngredient[] =>
  lines.map((l, position) => ({ position, ...parseIngredient(l) }))

const names = (step: string, list: RecipeIngredient[]): string[] =>
  ingredientsForStep(step, list).map((i) => i.raw)

describe('ingredientKeys', () => {
  it('drops descriptors and the prep note after the comma', () => {
    expect(ingredientKeys('brown onion, finely diced')).toEqual(['onion'])
    expect(ingredientKeys('canned cannellini beans, drained')).toEqual(['cannellini bean', 'bean'])
  })

  it('falls back to the first word when the head is a cut', () => {
    expect(ingredientKeys('chicken thigh fillets')).toEqual([
      'chicken thigh fillet',
      'fillet',
      'chicken'
    ])
  })
})

describe('ingredientsForStep', () => {
  const curry = ings(
    '2 tbsp olive oil',
    '1 brown onion, finely diced',
    '3 cloves garlic, crushed',
    '800 g chicken thigh fillets',
    '400 g canned diced tomatoes',
    '150 g cheddar cheese, grated',
    '1 tsp salt'
  )

  it('matches by head noun and plural', () => {
    expect(names('Soften the onions in the oil for 8 minutes', curry)).toEqual([
      '2 tbsp olive oil',
      '1 brown onion, finely diced'
    ])
  })

  it('matches a cut by its first word', () => {
    expect(names('Brown the chicken in batches', curry)).toEqual(['800 g chicken thigh fillets'])
    expect(names('Add the garlic for 30 seconds', curry)).toEqual(['3 cloves garlic, crushed'])
  })

  it('does not match inside another word', () => {
    expect(names('Poach in salted water', curry)).toEqual([])
  })

  it('prefers the ingredient the step names in full', () => {
    const both = ings('1 brown onion, diced', '4 spring onions, sliced')
    expect(names('Scatter over the spring onions', both)).toEqual(['4 spring onions, sliced'])
  })

  it('returns nothing for a step that names no ingredient', () => {
    expect(names('Rest 10 minutes, then serve', curry)).toEqual([])
  })
})
