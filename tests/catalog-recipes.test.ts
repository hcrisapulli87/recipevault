import { describe, it, expect } from 'vitest'
import catalog from '../src/shared/data/catalog-recipes.json'
import { CUISINES, DIET_TAGS, EFFORTS, MEAL_TYPES } from '../src/shared/types'
import { parseIngredient } from '../src/shared/ingredient-parser'
import { staplePer100g } from '../src/shared/nutrition'

/**
 * The catalog is hand-authored data, so it gets the same scrutiny as code. These checks
 * guard the fields the week generator actually branches on — a wrong `keepsDays` or
 * `reheat` produces an unsafe meal plan, not a cosmetic blemish.
 */

interface CatalogRecipe {
  slug: string
  title: string
  cuisine: string
  dietTags: string[]
  mealSlots: string[]
  effort: string
  keepsDays: number
  batchFriendly: boolean
  reheat: string
  servings: number
  prepMin: number
  cookMin: number
  description: string
  ingredients: string[]
  steps: string[]
}

const RECIPES = catalog as CatalogRecipe[]
const REHEATS = ['microwave', 'oven', 'cold', 'fresh-only']

describe('catalog shape', () => {
  it('is a non-empty array with unique slugs', () => {
    expect(RECIPES.length).toBeGreaterThan(0)
    const slugs = RECIPES.map((r) => r.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('uses kebab-case slugs', () => {
    for (const r of RECIPES) expect(r.slug, r.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  for (const r of RECIPES) {
    it(`${r.slug} has valid planner metadata`, () => {
      expect(r.title.trim().length, 'title').toBeGreaterThan(0)
      expect(r.description.trim().length, 'description').toBeGreaterThan(0)
      expect(CUISINES, 'cuisine').toContain(r.cuisine)
      expect(EFFORTS, 'effort').toContain(r.effort)
      expect(REHEATS, 'reheat').toContain(r.reheat)
      expect(r.dietTags.length, 'dietTags').toBeGreaterThan(0)
      for (const t of r.dietTags) expect(DIET_TAGS).toContain(t)
      expect(r.mealSlots.length, 'mealSlots').toBeGreaterThan(0)
      for (const s of r.mealSlots) expect(MEAL_TYPES).toContain(s)
      expect(r.servings, 'servings').toBeGreaterThan(0)
      expect(r.ingredients.length, 'ingredients').toBeGreaterThan(0)
      expect(r.steps.length, 'steps').toBeGreaterThan(0)
    })
  }
})

describe('catalog leftover safety', () => {
  it('keeps no recipe in the fridge longer than food-safety guidance allows', () => {
    // Health authorities put cooked leftovers at 3 to 4 days; 3 is the cap we plan to.
    for (const r of RECIPES) {
      expect(r.keepsDays, r.slug).toBeGreaterThanOrEqual(0)
      expect(r.keepsDays, r.slug).toBeLessThanOrEqual(3)
    }
  })

  it('never marks a fresh-only recipe as keeping', () => {
    for (const r of RECIPES) {
      if (r.reheat === 'fresh-only') expect(r.keepsDays, r.slug).toBeLessThanOrEqual(1)
    }
  })

  it('never marks a fresh-only recipe as batch friendly', () => {
    for (const r of RECIPES) {
      if (r.reheat === 'fresh-only') expect(r.batchFriendly, r.slug).toBe(false)
    }
  })

  it('gives every batch-friendly recipe somewhere to be chained to', () => {
    for (const r of RECIPES) {
      if (r.batchFriendly) expect(r.keepsDays, r.slug).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('catalog macro estimability', () => {
  // An ingredient the food table can't match is silently dropped from the estimate, so a
  // recipe full of unmatched lines reports a calorie count far below the truth.
  const matchRate = (r: CatalogRecipe): number => {
    const matched = r.ingredients.filter((line) => {
      const parsed = parseIngredient(line)
      return staplePer100g(parsed.name.replace(/\(.*?\)/g, '').split(',')[0].trim()) !== null
    }).length
    return matched / r.ingredients.length
  }

  for (const r of RECIPES) {
    it(`${r.slug} matches most of its ingredients to the food table`, () => {
      expect(Math.round(matchRate(r) * 100), `${r.slug} match rate`).toBeGreaterThanOrEqual(60)
    })
  }
})
