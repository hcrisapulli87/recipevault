import { describe, it, expect } from 'vitest'
import { staplePer100g } from '../src/shared/nutrition'

/**
 * Regression net for the recipe macro estimator's generic-food lookup.
 *
 * The original implementation took every AFCD food whose head name was a substring of the
 * ingredient (or vice versa) and kept the SHORTEST name. That produced silently wrong
 * matches that poisoned every estimate: "rice" → Liquorice, "coconut milk" → almond meal,
 * "tomatoes" → sundried tomato, "banana" → banana chip. These tests pin the everyday
 * ingredients a recipe catalog is built from to a sane calorie band.
 */

const kcal = (name: string): number | null => {
  const m = staplePer100g(name)
  return m ? Math.round(m.per100g.calories) : null
}

/** Asserts a match exists and lands in a plausible per-100 g band. */
function expectBand(name: string, low: number, high: number): void {
  const c = kcal(name)
  expect(c, `${name} had no match`).not.toBeNull()
  expect(c, `${name} → ${c} kcal/100 g, expected ${low}–${high}`).toBeGreaterThanOrEqual(low)
  expect(c!).toBeLessThanOrEqual(high)
}

describe('staplePer100g — word matching, not substrings', () => {
  it('does not match a word buried inside a longer word', () => {
    // "rice" ⊄ "liquorice", "nut" ⊄ "coconut"/"peanut"/"walnut".
    expectBand('rice', 300, 400)
    expectBand('basmati rice', 300, 400)
    expectBand('coconut milk', 140, 260)
  })

  it('prefers the plain everyday form over a processed one', () => {
    expectBand('tomatoes', 10, 40)
    expectBand('banana', 70, 130)
    expectBand('apple', 30, 90)
    expectBand('milk', 30, 90)
    expectBand('eggs', 100, 200)
  })

  it('still honours a processed form when the ingredient asks for one', () => {
    const fresh = kcal('tomatoes')!
    const canned = kcal('canned tomatoes')!
    const sundried = kcal('sundried tomatoes')!
    expect(canned).toBeLessThan(100)
    expect(sundried).toBeGreaterThan(fresh * 2)
  })
})

describe('staplePer100g — everyday catalog ingredients land in a sane band', () => {
  const CASES: [string, number, number][] = [
    ['chicken thigh fillets', 100, 260],
    ['chicken breast', 90, 190],
    ['beef mince', 130, 290],
    ['pork mince', 130, 300],
    ['bacon', 180, 350],
    ['salmon fillets', 130, 250],
    ['prawns', 60, 130],
    ['greek yoghurt', 40, 140],
    ['cheddar cheese', 300, 440],
    ['butter', 600, 800],
    ['olive oil', 780, 950],
    ['brown onion', 20, 60],
    ['carrots', 15, 60],
    ['potatoes', 50, 100],
    ['sweet potato', 60, 130],
    ['broccoli', 15, 60],
    ['mushrooms', 10, 60],
    ['baby spinach', 5, 45],
    ['canned chickpeas', 90, 200],
    ['red lentils', 280, 380],
    ['spaghetti', 300, 400],
    ['couscous', 320, 400],
    ['rolled oats', 320, 420],
    ['soy sauce', 20, 110],
    ['honey', 250, 350],
    ['tofu', 60, 200],
    ['peanut butter', 500, 700],
    ['avocado', 100, 250],
    // Aliased: the AFCD files these under names no recipe would write.
    ['almonds', 500, 700],
    ['cashews', 500, 700],
    ['plain flour', 300, 400],
    ['passata', 10, 60],
    ['canned black beans', 80, 200],
    ['white fish fillets', 60, 130],
    ['tortillas', 200, 350]
  ]
  for (const [name, low, high] of CASES) {
    it(`${name}`, () => expectBand(name, low, high))
  }
})

describe('staplePer100g — stock is not meat', () => {
  it('matches liquid stock, not the animal it came from', () => {
    // "500 ml chicken stock" matched to raw chicken mince added ~485 phantom calories.
    expectBand('chicken stock', 0, 60)
    expectBand('beef stock', 0, 60)
    expectBand('vegetable stock', 0, 60)
  })
})

describe('staplePer100g — backs off rather than giving up', () => {
  it('drops trailing qualifiers until something matches', () => {
    expect(kcal('firm tofu')).not.toBeNull()
    expect(kcal('ground cumin')).not.toBeNull()
    expect(kcal('boneless chicken thigh fillets')).not.toBeNull()
  })

  it('returns null for something genuinely absent', () => {
    expect(kcal('')).toBeNull()
    expect(kcal('zzzznotafood')).toBeNull()
  })
})
