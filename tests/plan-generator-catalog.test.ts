import { describe, it, expect } from 'vitest'
import { generateWeek } from '../src/shared/plan-generator'
import { CATALOG_RECIPES } from '../src/shared/data/catalog-recipes'
import { DAYS } from '../src/shared/types'
import type { Cuisine, RecipeSummary } from '../src/shared/types'

/**
 * The generator's own suite runs on fixtures. This one runs it against the REAL shipped
 * catalog, which is what actually decides whether a generated week is any good: fixtures
 * can't tell you the pool is too thin to fill seven breakfasts, or that every Spanish
 * dinner happens to be fresh-only.
 */

/** The catalog as the app sees it after seeding — ids assigned, macros present. */
const CATALOG: RecipeSummary[] = CATALOG_RECIPES.map((r, i) => ({
  id: i + 1,
  ownerId: 'seed',
  title: r.title,
  imageUrl: null,
  totalMin: r.prepMin + r.cookMin,
  servings: r.servings,
  est: { calories: 500, protein: 30, carbs: 50, fat: 18, matched: 8, total: 10, assumedServings: false },
  isCatalog: true,
  catalogSlug: r.slug,
  cuisine: r.cuisine,
  dietTags: r.dietTags,
  mealSlots: r.mealSlots,
  effort: r.effort,
  keepsDays: r.keepsDays,
  batchFriendly: r.batchFriendly,
  reheat: r.reheat
}))

const byId = new Map(CATALOG.map((r) => [r.id, r]))
const SEEDS = [1, 7, 42, 1234, 99999]

describe('generateWeek against the shipped catalog', () => {
  it('fills all 21 slots on the default settings, for every seed', () => {
    for (const seed of SEEDS) {
      const week = generateWeek(CATALOG, { seed })
      const empty = week.filter((e) => e.recipeId === null && e.freeText === null)
      expect(empty.map((e) => `${e.day}/${e.meal}`), `seed ${seed}`).toEqual([])
    }
  })

  it('never violates fridge life or chains a fresh-only recipe', () => {
    for (const seed of SEEDS) {
      for (const l of generateWeek(CATALOG, { seed }).filter((e) => e.isLeftover)) {
        const r = byId.get(l.recipeId!)!
        const gap = DAYS.indexOf(l.day) - DAYS.indexOf(l.cookDay!)
        expect(r.reheat, `${r.title} seed ${seed}`).not.toBe('fresh-only')
        expect(gap, `${r.title} seed ${seed}`).toBeLessThanOrEqual(r.keepsDays)
        expect(gap).toBeGreaterThan(0)
      }
    }
  })

  it('produces a week that actually earns its leftovers', () => {
    // The whole premise: cook a handful of nights, eat the rest from those batches.
    for (const seed of SEEDS) {
      const week = generateWeek(CATALOG, { seed })
      const leftovers = week.filter((e) => e.isLeftover)
      expect(leftovers.length, `seed ${seed}`).toBeGreaterThanOrEqual(4)
      const dinnerCooks = week.filter(
        (e) => e.meal === 'dinner' && !e.isLeftover && e.recipeId !== null
      )
      expect(dinnerCooks.length, `seed ${seed}`).toBe(4)
    }
  })

  it('varies the cuisines it cooks rather than serving one all week', () => {
    for (const seed of SEEDS) {
      const week = generateWeek(CATALOG, { seed })
      const cuisines = week
        .filter((e) => e.meal === 'dinner' && !e.isLeftover && e.recipeId !== null)
        .map((e) => byId.get(e.recipeId!)!.cuisine as Cuisine)
      expect(new Set(cuisines).size, `seed ${seed}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('records servings to cook on every non-leftover slot, so groceries can scale', () => {
    const week = generateWeek(CATALOG, { seed: 3, servingsPerMeal: 2 })
    for (const e of week.filter((x) => x.recipeId !== null && !x.isLeftover)) {
      expect(e.servingsPlanned, `${e.day}/${e.meal}`).toBeGreaterThanOrEqual(2)
    }
  })

  it('still fills every dinner when narrowed to one cuisine', () => {
    for (const cuisine of ['italian', 'greek', 'asian', 'mexican', 'american'] as Cuisine[]) {
      const week = generateWeek(CATALOG, { seed: 11, cuisines: [cuisine], slots: ['dinner'] })
      const dinners = week.filter((e) => e.meal === 'dinner' && e.recipeId !== null)
      expect(dinners.length, cuisine).toBeGreaterThanOrEqual(4)
      for (const d of dinners.filter((e) => !e.isLeftover)) {
        expect(byId.get(d.recipeId!)!.cuisine, cuisine).toBe(cuisine)
      }
    }
  })

  it('still fills a full week on the high-protein filter', () => {
    const week = generateWeek(CATALOG, { seed: 5, diets: ['high-protein'] })
    expect(week.filter((e) => e.recipeId === null && e.freeText === null)).toEqual([])
    for (const e of week.filter((x) => x.recipeId !== null)) {
      expect(byId.get(e.recipeId!)!.dietTags, byId.get(e.recipeId!)!.title).toContain(
        'high-protein'
      )
    }
  })
})
