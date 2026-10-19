import { describe, it, expect } from 'vitest'
import {
  calorieHitRate,
  proteinHitRate,
  shiftDate,
  standoutDays,
  weekStartOf,
  weeklyAverages
} from '../src/shared/trends'
import type { DailyTotals } from '../src/shared/types'

const T = (calories: number, protein = 0): DailyTotals => ({ calories, protein, carbs: 0, fat: 0 })
const TODAY = '2026-10-19' // a Monday

describe('hit rates', () => {
  const m = new Map([
    [TODAY, T(1900, 140)],
    [shiftDate(TODAY, -1), T(2300, 120)],
    [shiftDate(TODAY, -2), T(2000, 135)],
    [shiftDate(TODAY, -40), T(1000, 200)] // outside a 30-day window
  ])

  it('counts protein at ≥90% of goal over logged days only', () => {
    // goal 150 → threshold 135: 140 ✓, 120 ✗, 135 ✓
    expect(proteinHitRate(m, TODAY, 30, 150)).toEqual({ hit: 2, of: 3 })
  })

  it('counts calories at or under goal ×1.05', () => {
    // goal 2000 → ≤ 2100: 1900 ✓, 2300 ✗, 2000 ✓
    expect(calorieHitRate(m, TODAY, 30, 2000)).toEqual({ hit: 2, of: 3 })
  })

  it('is null without a goal', () => {
    expect(proteinHitRate(m, TODAY, 30, null)).toBeNull()
    expect(calorieHitRate(m, TODAY, 30, 0)).toBeNull()
  })
})

describe('standoutDays', () => {
  const m = new Map([
    [TODAY, T(5000, 400)], // today is still going — never a standout
    [shiftDate(TODAY, -1), T(2600, 110)],
    [shiftDate(TODAY, -2), T(2050, 160)],
    [shiftDate(TODAY, -3), T(1500, 90)]
  ])

  it('names the most-protein, biggest and closest-to-goal days', () => {
    const s = standoutDays(m, TODAY, 7, 2000)
    expect(s.mostProtein?.date).toBe(shiftDate(TODAY, -2))
    expect(s.biggest?.date).toBe(shiftDate(TODAY, -1))
    expect(s.closest?.date).toBe(shiftDate(TODAY, -2))
  })

  it('skips closest-to-goal without a goal, and everything with no past days', () => {
    expect(standoutDays(m, TODAY, 7, null).closest).toBeNull()
    expect(standoutDays(new Map([[TODAY, T(1)]]), TODAY, 7, 2000)).toEqual({
      mostProtein: null,
      biggest: null,
      closest: null
    })
  })
})

describe('weeklyAverages', () => {
  it('finds the Monday of any day', () => {
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19') // Monday
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19') // Sunday
    expect(weekStartOf('2026-10-21')).toBe('2026-10-19')
  })

  it('averages each Monday–Sunday week over its logged days, oldest first', () => {
    const m = new Map([
      ['2026-10-12', T(2000, 100)],
      ['2026-10-14', T(1000, 50)],
      ['2026-10-19', T(1800, 120)]
    ])
    const w = weeklyAverages(m, TODAY, 3)
    expect(w.map((x) => x.weekStart)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19'])
    expect(w[0]).toEqual({ weekStart: '2026-10-05', loggedDays: 0, avg: null })
    expect(w[1].loggedDays).toBe(2)
    expect(w[1].avg?.calories).toBe(1500)
    expect(w[2].avg?.protein).toBe(120)
  })
})
