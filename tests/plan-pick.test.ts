import { describe, it, expect } from 'vitest'
import { setCookSlot, reachesFrom } from '../src/shared/plan-generator'
import { parsePlanPrefs, DEFAULT_PLAN_PREFS } from '../src/shared/plan-prefs'
import { DAYS, PLAN_MEALS } from '../src/shared/types'
import type { Day, MealPlanEntry, PlanMeal, RecipeSummary } from '../src/shared/types'

let nextId = 1

function recipe(patch: Partial<RecipeSummary> = {}): RecipeSummary {
  const id = patch.id ?? nextId++
  return {
    id,
    ownerId: 'owner',
    title: `Recipe ${id}`,
    imageUrl: null,
    totalMin: 40,
    servings: 4,
    est: null,
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

/** A blank 21-slot week, the shape getMealPlan and generateWeek both produce. */
function blankWeek(): MealPlanEntry[] {
  return DAYS.flatMap((day) =>
    PLAN_MEALS.map((meal) => ({
      day,
      meal,
      recipeId: null,
      freeText: null,
      isLeftover: false,
      cookDay: null,
      servingsPlanned: null
    }))
  )
}

const at = (week: MealPlanEntry[], day: Day, meal: PlanMeal): MealPlanEntry =>
  week.find((e) => e.day === day && e.meal === meal)!

/** Monday dinner cooks recipe `id`, with Tuesday lunch + Wednesday dinner eating it. */
function weekWithBatch(id: number): MealPlanEntry[] {
  const week = blankWeek()
  Object.assign(at(week, 'monday', 'dinner'), { recipeId: id, servingsPlanned: 6 })
  Object.assign(at(week, 'tuesday', 'lunch'), {
    recipeId: id,
    isLeftover: true,
    cookDay: 'monday'
  })
  Object.assign(at(week, 'wednesday', 'dinner'), {
    recipeId: id,
    isLeftover: true,
    cookDay: 'monday'
  })
  return week
}

describe('reachesFrom', () => {
  it('allows a later day inside keepsDays', () => {
    expect(reachesFrom(recipe({ keepsDays: 3 }), 'monday', 'thursday')).toBe(true)
  })

  it('refuses a day past keepsDays', () => {
    expect(reachesFrom(recipe({ keepsDays: 2 }), 'monday', 'thursday')).toBe(false)
  })

  it('never chains a fresh-only dish', () => {
    expect(reachesFrom(recipe({ reheat: 'fresh-only', keepsDays: 5 }), 'monday', 'tuesday')).toBe(
      false
    )
  })

  it('refuses to travel backwards or onto the cook day itself', () => {
    expect(reachesFrom(recipe(), 'wednesday', 'monday')).toBe(false)
    expect(reachesFrom(recipe(), 'monday', 'monday')).toBe(false)
  })
})

describe('setCookSlot', () => {
  it('points the leftover slots at the newly picked dish', () => {
    const old = recipe({ id: 100 })
    const picked = recipe({ id: 200, keepsDays: 4 })
    const next = setCookSlot(weekWithBatch(old.id), { day: 'monday', meal: 'dinner' }, picked, 2)

    expect(at(next, 'monday', 'dinner')).toMatchObject({
      recipeId: 200,
      isLeftover: false,
      cookDay: null
    })
    expect(at(next, 'tuesday', 'lunch')).toMatchObject({
      recipeId: 200,
      isLeftover: true,
      cookDay: 'monday'
    })
    expect(at(next, 'wednesday', 'dinner')).toMatchObject({ recipeId: 200, isLeftover: true })
  })

  it('empties leftovers the new dish cannot reach instead of leaving them orphaned', () => {
    // Keeps 1 day: Tuesday still works, Wednesday (2 days out) does not.
    const picked = recipe({ id: 300, keepsDays: 1 })
    const next = setCookSlot(weekWithBatch(100), { day: 'monday', meal: 'dinner' }, picked, 2)

    expect(at(next, 'tuesday', 'lunch').recipeId).toBe(300)
    expect(at(next, 'wednesday', 'dinner')).toMatchObject({
      recipeId: null,
      isLeftover: false,
      cookDay: null
    })
  })

  it('drops every leftover when the new dish is fresh-only', () => {
    const picked = recipe({ id: 400, reheat: 'fresh-only' })
    const next = setCookSlot(weekWithBatch(100), { day: 'monday', meal: 'dinner' }, picked, 2)

    expect(at(next, 'tuesday', 'lunch').recipeId).toBeNull()
    expect(at(next, 'wednesday', 'dinner').recipeId).toBeNull()
    // Nothing else to feed, so the batch shrinks back to the one meal.
    expect(at(next, 'monday', 'dinner').servingsPlanned).toBe(2)
  })

  it('rebuilds servingsPlanned from the leftovers that survived', () => {
    const next = setCookSlot(
      weekWithBatch(100),
      { day: 'monday', meal: 'dinner' },
      recipe({ id: 500, keepsDays: 4 }),
      3
    )
    // The cook night plus two surviving leftover meals, at 3 serves each.
    expect(at(next, 'monday', 'dinner').servingsPlanned).toBe(9)
  })

  it('leaves the input week untouched', () => {
    const week = weekWithBatch(100)
    setCookSlot(week, { day: 'monday', meal: 'dinner' }, recipe({ id: 600 }), 2)
    expect(at(week, 'monday', 'dinner').recipeId).toBe(100)
    expect(at(week, 'tuesday', 'lunch').recipeId).toBe(100)
  })

  it('ignores leftovers of a different batch on the same day', () => {
    const week = weekWithBatch(100)
    // Another cook night's leftovers, chained from Monday's *lunch*, not its dinner.
    Object.assign(at(week, 'thursday', 'lunch'), {
      recipeId: 999,
      isLeftover: true,
      cookDay: 'monday'
    })
    const next = setCookSlot(week, { day: 'monday', meal: 'dinner' }, recipe({ id: 700 }), 2)
    expect(at(next, 'thursday', 'lunch').recipeId).toBe(999)
  })
})

describe('parsePlanPrefs', () => {
  it('falls back to the defaults for null or junk', () => {
    expect(parsePlanPrefs(null)).toEqual(DEFAULT_PLAN_PREFS)
    expect(parsePlanPrefs('nope')).toEqual(DEFAULT_PLAN_PREFS)
  })

  it('keeps stored answers it recognises', () => {
    expect(
      parsePlanPrefs({
        diets: ['high-protein'],
        cuisines: ['greek'],
        cookNights: 3,
        servingsPerMeal: 4,
        leftoverAppetite: 'high',
        slots: ['dinner']
      })
    ).toEqual({
      diets: ['high-protein'],
      cuisines: ['greek'],
      cookNights: 3,
      servingsPerMeal: 4,
      leftoverAppetite: 'high',
      slots: ['dinner']
    })
  })

  it('drops tags and cuisines the catalog no longer knows', () => {
    const prefs = parsePlanPrefs({ diets: ['high-protein', 'paleolithic'], cuisines: ['atlantean'] })
    expect(prefs.diets).toEqual(['high-protein'])
    expect(prefs.cuisines).toEqual([])
  })

  it('clamps out-of-range numbers rather than passing them to the generator', () => {
    const prefs = parsePlanPrefs({ cookNights: 99, servingsPerMeal: 0 })
    expect(prefs.cookNights).toBe(7)
    expect(prefs.servingsPerMeal).toBe(1)
  })

  it('treats an empty slots list as never answered — it would generate nothing', () => {
    expect(parsePlanPrefs({ slots: [] }).slots).toEqual(DEFAULT_PLAN_PREFS.slots)
  })

  it('ignores an unknown leftover appetite', () => {
    expect(parsePlanPrefs({ leftoverAppetite: 'infinite' }).leftoverAppetite).toBe(
      DEFAULT_PLAN_PREFS.leftoverAppetite
    )
  })
})
