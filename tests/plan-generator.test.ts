import { describe, it, expect } from 'vitest'
import { generateWeek, DEFAULT_GENERATE_OPTIONS } from '../src/shared/plan-generator'
import type { GenerateOptions } from '../src/shared/plan-generator'
import { DAYS, PLAN_MEALS } from '../src/shared/types'
import type { Cuisine, MealPlanEntry, MealType, RecipeSummary } from '../src/shared/types'

let nextId = 1

/** A catalog recipe with sensible batch-cooking defaults; override what a test cares about. */
function recipe(patch: Partial<RecipeSummary> = {}): RecipeSummary {
  const id = patch.id ?? nextId++
  return {
    id,
    ownerId: 'owner',
    title: `Recipe ${id}`,
    imageUrl: null,
    totalMin: 40,
    servings: 4,
    est: {
      calories: 500,
      protein: 30,
      carbs: 50,
      fat: 18,
      matched: 8,
      total: 10,
      assumedServings: false
    },
    isCatalog: true,
    catalogSlug: `recipe-${id}`,
    cuisine: 'italian',
    dietTags: ['balanced'],
    mealSlots: ['dinner'],
    effort: 'easy',
    keepsDays: 3,
    batchFriendly: true,
    reheat: 'microwave',
    ...patch
  }
}

/** Enough variety that the "avoid repeating a cuisine back to back" rule can be satisfied. */
function dinnerPool(count = 12): RecipeSummary[] {
  const cuisines: Cuisine[] = ['italian', 'greek', 'asian', 'mexican']
  return Array.from({ length: count }, (_, i) =>
    recipe({ cuisine: cuisines[i % cuisines.length], mealSlots: ['dinner', 'lunch'] })
  )
}

function lunchPool(count = 6): RecipeSummary[] {
  return Array.from({ length: count }, () =>
    recipe({ mealSlots: ['lunch'], effort: 'minimal', batchFriendly: false, keepsDays: 1 })
  )
}

function breakfastPool(count = 4): RecipeSummary[] {
  return Array.from({ length: count }, () =>
    recipe({ mealSlots: ['breakfast'], effort: 'minimal', batchFriendly: false, keepsDays: 0 })
  )
}

function opts(patch: Partial<GenerateOptions> = {}): GenerateOptions {
  return { ...DEFAULT_GENERATE_OPTIONS, seed: 1, ...patch }
}

const at = (week: MealPlanEntry[], day: string, meal: string): MealPlanEntry =>
  week.find((e) => e.day === day && e.meal === meal)!

const filled = (week: MealPlanEntry[]): MealPlanEntry[] =>
  week.filter((e) => e.recipeId !== null || e.freeText !== null)

const cookNights = (week: MealPlanEntry[]): MealPlanEntry[] =>
  filled(week).filter((e) => !e.isLeftover)

const leftovers = (week: MealPlanEntry[]): MealPlanEntry[] => week.filter((e) => e.isLeftover)

describe('generateWeek — shape', () => {
  it('always returns all 21 slots in getMealPlan order, so empty slots can be cleared', () => {
    const week = generateWeek(dinnerPool(), opts())
    expect(week).toHaveLength(21)
    expect(week.map((e) => e.day)).toEqual(DAYS.flatMap((d) => [d, d, d]))
    expect(week.map((e) => e.meal)).toEqual(DAYS.flatMap(() => PLAN_MEALS))
  })

  it('returns an all-blank week rather than throwing when the catalog is empty', () => {
    const week = generateWeek([], opts())
    expect(week).toHaveLength(21)
    expect(filled(week)).toHaveLength(0)
  })

  it('only fills the meal slots that were requested', () => {
    const week = generateWeek([...dinnerPool(), ...lunchPool(), ...breakfastPool()], opts({ slots: ['dinner'] }))
    expect(filled(week).every((e) => e.meal === 'dinner')).toBe(true)
  })
})

describe('generateWeek — cook nights', () => {
  it('cooks exactly the requested number of nights, spread across the week', () => {
    const week = generateWeek(dinnerPool(), opts({ cookNights: 4, slots: ['dinner'] }))
    const nights = cookNights(week)
    expect(nights).toHaveLength(4)
    // Spread, not clustered: no two cook nights on consecutive days for 4-of-7.
    const idx = nights.map((n) => DAYS.indexOf(n.day)).sort((a, b) => a - b)
    expect(new Set(idx).size).toBe(4)
    expect(Math.max(...idx) - Math.min(...idx)).toBeGreaterThanOrEqual(4)
  })

  it('records servings to cook so groceries can scale the batch', () => {
    const week = generateWeek(
      dinnerPool(),
      opts({ cookNights: 3, servingsPerMeal: 2, leftoverAppetite: 'medium' })
    )
    // A day can hold both a lunch fill and a dinner cook, so a batch's repeats are the
    // leftovers matching BOTH its day and its recipe.
    for (const night of cookNights(week)) {
      const repeats = leftovers(week).filter(
        (l) => l.cookDay === night.day && l.recipeId === night.recipeId
      ).length
      expect(night.servingsPlanned).toBe(2 * (1 + repeats))
    }
  })

  it('avoids two cook nights of the same cuisine back to back when the pool allows', () => {
    const pool = dinnerPool(12)
    const week = generateWeek(pool, opts({ cookNights: 4, slots: ['dinner'] }))
    const cuisineOf = (id: number): Cuisine | null =>
      pool.find((r) => r.id === id)?.cuisine ?? null
    const seq = cookNights(week).map((n) => cuisineOf(n.recipeId!))
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1])
  })

  it('degrades to fewer cook nights instead of throwing when the pool is too small', () => {
    const week = generateWeek([recipe()], opts({ cookNights: 5, slots: ['dinner'] }))
    expect(cookNights(week).length).toBeGreaterThan(0)
    expect(cookNights(week).length).toBeLessThanOrEqual(5)
  })
})

describe('generateWeek — leftovers', () => {
  it('chains a batch forward into later slots, pointing at the same recipe', () => {
    const week = generateWeek(dinnerPool(), opts({ leftoverAppetite: 'medium' }))
    const chained = leftovers(week)
    expect(chained.length).toBeGreaterThan(0)
    for (const l of chained) {
      const cook = at(week, l.cookDay!, 'dinner')
      expect(l.recipeId).toBe(cook.recipeId)
      expect(cook.isLeftover).toBe(false)
    }
  })

  it('never places a leftover further from its cook night than the recipe keeps', () => {
    const pool = dinnerPool().map((r) => ({ ...r, keepsDays: 1 }))
    const week = generateWeek(pool, opts({ leftoverAppetite: 'high' }))
    for (const l of leftovers(week)) {
      const gap = DAYS.indexOf(l.day) - DAYS.indexOf(l.cookDay!)
      expect(gap).toBeGreaterThan(0)
      expect(gap).toBeLessThanOrEqual(1)
    }
  })

  it('never chains a fresh-only recipe', () => {
    const pool = dinnerPool().map((r) => ({ ...r, reheat: 'fresh-only' as const }))
    const week = generateWeek(pool, opts({ leftoverAppetite: 'high' }))
    expect(leftovers(week)).toHaveLength(0)
  })

  it('never chains a recipe that keeps zero days', () => {
    const pool = dinnerPool().map((r) => ({ ...r, keepsDays: 0 }))
    const week = generateWeek(pool, opts({ leftoverAppetite: 'high' }))
    expect(leftovers(week)).toHaveLength(0)
  })

  it('caps repeats per batch by the leftover appetite', () => {
    const cap = { low: 1, medium: 2, high: 3 } as const
    for (const appetite of ['low', 'medium', 'high'] as const) {
      const pool = dinnerPool().map((r) => ({ ...r, keepsDays: 5 }))
      const week = generateWeek(pool, opts({ leftoverAppetite: appetite, cookNights: 2 }))
      for (const night of cookNights(week).filter((n) => n.meal === 'dinner')) {
        const repeats = leftovers(week).filter((l) => l.cookDay === night.day).length
        expect(repeats).toBeLessThanOrEqual(cap[appetite])
      }
    }
  })

  it('prefers lunch for leftovers — dinner one night becomes lunch the next day', () => {
    const week = generateWeek(dinnerPool(), opts({ cookNights: 2, leftoverAppetite: 'medium' }))
    const lunchLeftovers = leftovers(week).filter((l) => l.meal === 'lunch')
    expect(lunchLeftovers.length).toBeGreaterThan(0)
  })

  it('does not put leftovers in breakfast slots', () => {
    const week = generateWeek(dinnerPool(), opts({ leftoverAppetite: 'high' }))
    expect(leftovers(week).some((l) => l.meal === 'breakfast')).toBe(false)
  })
})

describe('generateWeek — fills', () => {
  it('fills lunches the leftovers did not reach', () => {
    const pool = [...dinnerPool().map((r) => ({ ...r, mealSlots: ['dinner'] as MealType[] })), ...lunchPool()]
    const week = generateWeek(pool, opts({ cookNights: 2, leftoverAppetite: 'low' }))
    const lunches = week.filter((e) => e.meal === 'lunch')
    expect(lunches.every((l) => l.recipeId !== null)).toBe(true)
  })

  it('rotates a small set of breakfasts across the week', () => {
    const week = generateWeek([...dinnerPool(), ...breakfastPool()], opts())
    const breakfasts = week.filter((e) => e.meal === 'breakfast')
    expect(breakfasts.every((b) => b.recipeId !== null)).toBe(true)
    const distinct = new Set(breakfasts.map((b) => b.recipeId))
    expect(distinct.size).toBeGreaterThan(1)
    expect(distinct.size).toBeLessThanOrEqual(3)
  })

  it('leaves a slot blank rather than planning a recipe that does not suit it', () => {
    // Dinner-only pool, but breakfasts were requested.
    const week = generateWeek(dinnerPool(), opts({ slots: ['breakfast'] }))
    expect(filled(week)).toHaveLength(0)
  })
})

describe('generateWeek — filters', () => {
  it('honours the diet filter', () => {
    const pool = [
      ...dinnerPool(4).map((r) => ({ ...r, dietTags: ['balanced' as const] })),
      ...dinnerPool(4).map((r) => ({ ...r, dietTags: ['high-protein' as const] }))
    ]
    const week = generateWeek(pool, opts({ diets: ['high-protein'], slots: ['dinner'] }))
    for (const e of filled(week)) {
      expect(pool.find((r) => r.id === e.recipeId)!.dietTags).toContain('high-protein')
    }
  })

  it('honours the cuisine filter on cook nights', () => {
    const pool = dinnerPool(12)
    const week = generateWeek(pool, opts({ cuisines: ['greek'], slots: ['dinner'] }))
    for (const e of cookNights(week)) {
      expect(pool.find((r) => r.id === e.recipeId)!.cuisine).toBe('greek')
    }
  })

  it('ignores untagged personal imports — they carry no planner metadata', () => {
    const untagged = recipe({
      isCatalog: false,
      catalogSlug: null,
      cuisine: null,
      dietTags: [],
      mealSlots: [],
      effort: null,
      keepsDays: 0,
      batchFriendly: false,
      reheat: null
    })
    const week = generateWeek([untagged], opts())
    expect(filled(week)).toHaveLength(0)
  })
})

describe('generateWeek — locked slots', () => {
  it('never overwrites a locked slot and carries it through verbatim', () => {
    const locked: MealPlanEntry = {
      day: 'wednesday',
      meal: 'dinner',
      recipeId: null,
      freeText: 'Dinner at Mum’s',
      isLeftover: false,
      cookDay: null,
      servingsPlanned: null
    }
    const week = generateWeek(dinnerPool(), opts({ locked: [locked] }))
    expect(at(week, 'wednesday', 'dinner')).toEqual(locked)
  })

  it('does not chain leftovers over a locked slot', () => {
    const locked: MealPlanEntry = {
      day: 'tuesday',
      meal: 'lunch',
      recipeId: null,
      freeText: 'Work lunch',
      isLeftover: false,
      cookDay: null,
      servingsPlanned: null
    }
    const week = generateWeek(dinnerPool(), opts({ locked: [locked], leftoverAppetite: 'high' }))
    expect(at(week, 'tuesday', 'lunch').freeText).toBe('Work lunch')
    expect(at(week, 'tuesday', 'lunch').isLeftover).toBe(false)
  })
})

describe('generateWeek — determinism', () => {
  it('gives the same week for the same seed', () => {
    const pool = dinnerPool()
    expect(generateWeek(pool, opts({ seed: 42 }))).toEqual(generateWeek(pool, opts({ seed: 42 })))
  })

  it('gives a different week for a different seed', () => {
    const pool = dinnerPool(16)
    const a = generateWeek(pool, opts({ seed: 1 }))
    const b = generateWeek(pool, opts({ seed: 2 }))
    expect(a).not.toEqual(b)
  })
})
