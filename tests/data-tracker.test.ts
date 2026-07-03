import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addLogEntry, getDailyLog, getProfile, updateProfile } from '../src/renderer/data/tracker'

// In-memory stand-in for the two tracker tables. vi.hoisted so the vi.mock
// factory (hoisted above imports) can close over it.
const state = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  foodLog: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  upserted: [] as Record<string, unknown>[]
}))

vi.mock('../src/renderer/data/supabase', () => {
  // Thenable query builder: every chained call resolves to the same result.
  const chain = (data: unknown): Record<string, unknown> => {
    const result = { data, error: null }
    const node: Record<string, unknown> = {
      then: (ok: (r: unknown) => unknown) => Promise.resolve(result).then(ok),
      maybeSingle: () => Promise.resolve(result)
    }
    for (const m of ['select', 'eq', 'order']) node[m] = () => chain(data)
    return node
  }
  return {
    supabase: {
      auth: {
        getUser: async () => ({
          data: { user: { id: 'user-1', email: 'harrison@example.com' } }
        })
      },
      from: (table: string) => ({
        select: () => chain(table === 'profiles' ? state.profile : state.foodLog),
        upsert: (row: Record<string, unknown>) => {
          state.upserted.push(row)
          return Promise.resolve({ error: null })
        },
        insert: (row: Record<string, unknown>) => {
          state.inserted.push(row)
          return Promise.resolve({ error: null })
        }
      })
    }
  }
})

function logRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    meal_type: 'breakfast',
    name: 'Rolled oats',
    brand: null,
    amount: 1,
    unit: 'serving',
    base_calories: 150,
    base_protein: 5,
    base_carbs: 27,
    base_fat: 3,
    barcode: null,
    source: 'staple',
    ...over
  }
}

beforeEach(() => {
  state.profile = null
  state.foodLog = []
  state.inserted = []
  state.upserted = []
})

describe('getProfile', () => {
  it('creates the profile row (named from the email) on first sign-in', async () => {
    const p = await getProfile()
    expect(p).toEqual({
      name: 'harrison@example.com',
      calGoal: null,
      proteinGoal: null,
      carbsGoal: null,
      fatGoal: null
    })
    expect(state.upserted).toEqual([{ id: 'user-1', display_name: 'harrison@example.com' }])
  })

  it('maps an existing row to camelCase goals', async () => {
    state.profile = {
      id: 'user-1',
      display_name: 'Harrison',
      cal_goal: 2000,
      protein_goal: 150,
      carbs_goal: 200,
      fat_goal: 60
    }
    const p = await getProfile()
    expect(p).toEqual({
      name: 'Harrison',
      calGoal: 2000,
      proteinGoal: 150,
      carbsGoal: 200,
      fatGoal: 60
    })
    expect(state.upserted).toHaveLength(0)
  })
})

describe('updateProfile', () => {
  it('upserts snake_case columns keyed by the auth user id', async () => {
    await updateProfile({
      name: 'Harrison',
      goals: { calGoal: 1800, proteinGoal: 120, carbsGoal: null, fatGoal: null }
    })
    expect(state.upserted).toEqual([
      {
        id: 'user-1',
        display_name: 'Harrison',
        cal_goal: 1800,
        protein_goal: 120,
        carbs_goal: null,
        fat_goal: null
      }
    ])
  })
})

describe('getDailyLog', () => {
  it('groups entries by meal and totals base macros × amount', async () => {
    state.foodLog = [
      logRow({ id: 1, meal_type: 'breakfast', amount: 2 }), // 2× oats
      logRow({
        id: 2,
        meal_type: 'lunch',
        name: 'Chicken',
        base_calories: 200,
        base_protein: 40,
        base_carbs: 0,
        base_fat: 4
      })
    ]
    const log = await getDailyLog('2026-07-02', { id: 'user-1', isMe: true })
    expect(log.meals.breakfast).toHaveLength(1)
    expect(log.meals.lunch).toHaveLength(1)
    expect(log.meals.dinner).toHaveLength(0)
    expect(log.meals.snack).toHaveLength(0)
    // breakfast 150×2 + lunch 200 = 500 kcal; protein 5×2 + 40 = 50
    expect(log.totals.calories).toBe(500)
    expect(log.totals.protein).toBe(50)
    expect(log.meals.breakfast[0]).toMatchObject({ name: 'Rolled oats', baseCalories: 150 })
  })

  it('attaches the profile goals', async () => {
    state.profile = {
      id: 'user-1',
      display_name: 'Harrison',
      cal_goal: 1800,
      protein_goal: 120,
      carbs_goal: null,
      fat_goal: null
    }
    const log = await getDailyLog('2026-07-02', { id: 'user-1', isMe: true })
    expect(log.goals).toEqual({ calories: 1800, protein: 120, carbs: null, fat: null })
  })

  it("reads the partner's goals without auto-creating a profile row", async () => {
    state.profile = {
      id: 'user-2',
      display_name: 'Partner',
      cal_goal: 2200,
      protein_goal: 100,
      carbs_goal: null,
      fat_goal: null
    }
    const log = await getDailyLog('2026-07-02', { id: 'user-2', isMe: false })
    expect(log.goals).toEqual({ calories: 2200, protein: 100, carbs: null, fat: null })
    expect(state.upserted).toHaveLength(0) // partner path never writes
  })
})

describe('addLogEntry', () => {
  it('maps camelCase fields to snake_case columns (owner stamped by DB default)', async () => {
    await addLogEntry({
      date: '2026-07-02',
      mealType: 'snack',
      name: 'Apple',
      brand: null,
      amount: 1,
      unit: 'serving',
      baseCalories: 95,
      baseProtein: 0.5,
      baseCarbs: 25,
      baseFat: 0.3,
      barcode: null,
      source: 'staple'
    })
    expect(state.inserted).toEqual([
      {
        log_date: '2026-07-02',
        meal_type: 'snack',
        name: 'Apple',
        brand: null,
        amount: 1,
        unit: 'serving',
        base_calories: 95,
        base_protein: 0.5,
        base_carbs: 25,
        base_fat: 0.3,
        barcode: null,
        source: 'staple'
      }
    ])
  })
})
