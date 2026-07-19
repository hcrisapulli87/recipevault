import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getMealPlan, setMeal, clearWeek } from '../src/renderer/data/mealPlan'
import { DAYS, PLAN_MEALS } from '../src/shared/types'

// In-memory stand-in for the meal_plan table. vi.hoisted so the vi.mock
// factory (hoisted above imports) can close over it.
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  upserted: [] as { row: Record<string, unknown>; options: Record<string, unknown> }[],
  deletedDays: null as string[] | null
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
        upsert: (row: Record<string, unknown>, options: Record<string, unknown>) => {
          state.upserted.push({ row, options })
          return Promise.resolve({ error: null })
        },
        delete: () => ({
          in: (_col: string, days: string[]) => {
            state.deletedDays = days
            return Promise.resolve({ error: null })
          }
        })
      })
    }
  }
})

beforeEach(() => {
  state.rows = []
  state.upserted = []
  state.deletedDays = null
})

describe('getMealPlan', () => {
  it('returns 21 blank slots (7 days × 3 meals) for an empty week, day-major order', async () => {
    const plan = await getMealPlan()
    expect(plan).toHaveLength(21)
    expect(plan.map((e) => e.day)).toEqual(DAYS.flatMap((d) => [d, d, d]))
    expect(plan.map((e) => e.meal)).toEqual(DAYS.flatMap(() => PLAN_MEALS))
    expect(plan.every((e) => e.recipeId === null && e.freeText === null)).toBe(true)
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
    expect(monDinner).toEqual({ day: 'monday', meal: 'dinner', recipeId: 7, freeText: null })
    expect(tueBreakfast).toEqual({
      day: 'tuesday',
      meal: 'breakfast',
      recipeId: null,
      freeText: 'Overnight oats'
    })
    expect(monLunch).toEqual({ day: 'monday', meal: 'lunch', recipeId: null, freeText: null })
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
          meal_text: 'Chicken wrap'
        },
        options: { onConflict: 'day,meal' }
      }
    ])
  })
})

describe('clearWeek', () => {
  it('deletes every day of the week', async () => {
    await clearWeek()
    expect(state.deletedDays).toEqual(DAYS)
  })
})
