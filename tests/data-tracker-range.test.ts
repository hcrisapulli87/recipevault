import { describe, it, expect, vi } from 'vitest'
import { getDailyTotalsRange } from '../src/renderer/data/tracker'

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  filters: [] as unknown[]
}))
vi.mock('../src/renderer/data/supabase', () => {
  const chain = (data: unknown): Record<string, unknown> => {
    const node: Record<string, unknown> = {
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok)
    }
    for (const m of ['select', 'eq', 'gte', 'lte', 'order']) {
      node[m] = (...args: unknown[]) => {
        state.filters.push([m, ...args])
        return chain(data)
      }
    }
    return node
  }
  return { supabase: { from: () => chain(state.rows) } }
})

describe('getDailyTotalsRange', () => {
  it('aggregates base×amount per day into a Map', async () => {
    state.rows = [
      {
        log_date: '2026-07-05',
        amount: 2,
        base_calories: 150,
        base_protein: 5,
        base_carbs: 27,
        base_fat: 3
      },
      {
        log_date: '2026-07-05',
        amount: 1,
        base_calories: 200,
        base_protein: 40,
        base_carbs: 0,
        base_fat: 4
      },
      {
        log_date: '2026-07-06',
        amount: 1,
        base_calories: 300,
        base_protein: 10,
        base_carbs: 30,
        base_fat: 10
      }
    ]
    const map = await getDailyTotalsRange('user-1', '2026-06-07', '2026-07-06')
    expect(map.size).toBe(2)
    expect(map.get('2026-07-05')).toEqual({ calories: 500, protein: 50, carbs: 54, fat: 10 })
    expect(map.get('2026-07-06')).toEqual({ calories: 300, protein: 10, carbs: 30, fat: 10 })
    expect(state.filters).toContainEqual(['eq', 'owner_id', 'user-1'])
    expect(state.filters).toContainEqual(['gte', 'log_date', '2026-06-07'])
    expect(state.filters).toContainEqual(['lte', 'log_date', '2026-07-06'])
  })
})
