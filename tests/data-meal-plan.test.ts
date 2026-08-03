import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getMealPlan,
  setMeal,
  clearWeek,
  applyGeneratedWeek
} from '../src/renderer/data/mealPlan'
import { DAYS, PLAN_MEALS } from '../src/shared/types'
import type { MealPlanEntry } from '../src/shared/types'

// In-memory stand-in for the meal_plan table. vi.hoisted so the vi.mock
// factory (hoisted above imports) can close over it.
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  upserted: [] as { row: unknown; options: Record<string, unknown> }[],
  deletedDays: null as string[] | null,
  // applyGeneratedWeek clears empty slots per day: .delete().eq('day', d).in('meal', […])
  deletedSlots: [] as { day: string; meals: string[] }[]
}))

vi.mock('../src/renderer/data/supabase', () => {
  // Thenable query builder: every chained call resolves to the same result.
  const chain = (data: unknown): Record<string, unknown> => {
    const result = { data, error: null }
    const node: Record<string, unknown> = {
      then: (ok: (r: unknown) => unknown) => Promise.resolve(result).then(ok)
    }
    for (const m of ['select', 'eq']) node[m] = () => chain(data)
    return node
  }
  return {
    supabase: {
      from: () => ({
        select: () => chain(state.rows),
        upsert: (row: unknown, options: Record<string, unknown>) => {
          state.upserted.push({ row, options })
          return Promise.resolve({ error: null })
        },
        delete: () => ({
          // clearWeek: .delete().in('day', DAYS)
          in: (_col: string, days: string[]) => {
            state.deletedDays = days
            return Promise.resolve({ error: null })
          },
          // applyGeneratedWeek: .delete().eq('day', d).in('meal', meals)
          eq: (_col: string, day: string) => ({
            in: (_mealCol: string, meals: string[]) => {
              state.deletedSlots.push({ day, meals })
              return Promise.resolve({ error: null })
            }
          })
        })
      })
    }
  }
})

beforeEach(() => {
  state.rows = []
  state.upserted = []
  state.deletedDays = null
  state.deletedSlots = []
})

/** A blank slot in the shape getMealPlan/generateWeek produce. */
const slot = (day: string, meal: string, patch: Partial<MealPlanEntry> = {}): MealPlanEntry =>
  ({
    day,
    meal,
    recipeId: null,
    freeText: null,
    isLeftover: false,
    cookDay: null,
    servingsPlanned: null,
    ...patch
  }) as MealPlanEntry

describe('getMealPlan', () => {
  it('returns 21 blank slots (7 days × 3 meals) for an empty week, day-major order', async () => {
    const plan = await getMealPlan()
    expect(plan).toHaveLength(21)
    expect(plan.map((e) => e.day)).toEqual(DAYS.flatMap((d) => [d, d, d]))
    expect(plan.map((e) => e.meal)).toEqual(DAYS.flatMap(() => PLAN_MEALS))
    expect(plan.every((e) => e.recipeId === null && e.freeText === null)).toBe(true)
    expect(plan.every((e) => e.isLeftover === false)).toBe(true)
  })

  it('maps stored rows onto their day+meal slot', async () => {
    state.rows = [
      { day: 'monday', meal: 'dinner', recipe_id: 7, free_text: null },
      { day: 'tuesday', meal: 'breakfast', recipe_id: null, free_text: 'Overnight oats' }
    ]
    const plan = await getMealPlan()
    const monDinner = plan.find((e) => e.day === 'monday' && e.meal === 'dinner')
    const tueBreakfast = plan.find((e) => e.day === 'tuesday' && e.meal === 'breakfast')
    const monLunch = plan.find((e) => e.day === 'monday' && e.meal === 'lunch')
    expect(monDinner).toEqual(slot('monday', 'dinner', { recipeId: 7 }))
    expect(tueBreakfast).toEqual(slot('tuesday', 'breakfast', { freeText: 'Overnight oats' }))
    expect(monLunch).toEqual(slot('monday', 'lunch'))
  })

  it('maps the leftover columns, defaulting rows written before the migration', async () => {
    state.rows = [
      {
        day: 'monday',
        meal: 'dinner',
        recipe_id: 7,
        free_text: null,
        is_leftover: false,
        cook_day: null,
        servings_planned: 6
      },
      // A pre-migration row: the leftover columns simply aren't selected back as values.
      { day: 'tuesday', meal: 'lunch', recipe_id: 7, free_text: null, is_leftover: true, cook_day: 'monday' }
    ]
    const plan = await getMealPlan()
    expect(plan.find((e) => e.day === 'monday' && e.meal === 'dinner')).toEqual(
      slot('monday', 'dinner', { recipeId: 7, servingsPlanned: 6 })
    )
    expect(plan.find((e) => e.day === 'tuesday' && e.meal === 'lunch')).toEqual(
      slot('tuesday', 'lunch', { recipeId: 7, isLeftover: true, cookDay: 'monday' })
    )
  })
})

describe('setMeal', () => {
  it('upserts one shared slot keyed by day+meal, with the denormalised meal_text', async () => {
    await setMeal({
      day: 'wednesday',
      meal: 'lunch',
      recipeId: 3,
      freeText: null,
      mealText: 'Chicken wrap'
    })
    expect(state.upserted).toEqual([
      {
        row: {
          day: 'wednesday',
          meal: 'lunch',
          recipe_id: 3,
          free_text: null,
          meal_text: 'Chicken wrap',
          is_leftover: false,
          cook_day: null,
          servings_planned: null
        },
        options: { onConflict: 'day,meal' }
      }
    ])
  })

  it('carries the leftover fields when a slot eats another night’s batch', async () => {
    await setMeal({
      day: 'thursday',
      meal: 'lunch',
      recipeId: 3,
      freeText: null,
      mealText: 'Leftovers · Chilli',
      isLeftover: true,
      cookDay: 'wednesday'
    })
    expect(state.upserted[0].row).toMatchObject({
      is_leftover: true,
      cook_day: 'wednesday',
      meal_text: 'Leftovers · Chilli'
    })
  })
})

describe('applyGeneratedWeek', () => {
  it('upserts filled slots in one batch and deletes the empty ones per day', async () => {
    const entries = [
      slot('monday', 'dinner', { recipeId: 7, servingsPlanned: 6 }),
      slot('tuesday', 'lunch', { recipeId: 7, isLeftover: true, cookDay: 'monday' }),
      slot('tuesday', 'dinner'),
      slot('wednesday', 'breakfast')
    ]
    await applyGeneratedWeek(entries, (e) => (e.isLeftover ? 'Leftovers · Chilli' : 'Chilli'))

    expect(state.upserted).toHaveLength(1)
    const rows = state.upserted[0].row as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ day: 'monday', meal_text: 'Chilli', servings_planned: 6 })
    expect(rows[1]).toMatchObject({
      day: 'tuesday',
      is_leftover: true,
      cook_day: 'monday',
      meal_text: 'Leftovers · Chilli'
    })

    expect(state.deletedSlots).toEqual([
      { day: 'tuesday', meals: ['dinner'] },
      { day: 'wednesday', meals: ['breakfast'] }
    ])
  })

  it('skips the upsert entirely when the generated week is empty', async () => {
    await applyGeneratedWeek([slot('monday', 'dinner')], () => null)
    expect(state.upserted).toEqual([])
    expect(state.deletedSlots).toEqual([{ day: 'monday', meals: ['dinner'] }])
  })
})

describe('clearWeek', () => {
  it('deletes every day of the week', async () => {
    await clearWeek()
    expect(state.deletedDays).toEqual(DAYS)
  })
})
