import { describe, it, expect } from 'vitest'
import { summarizeWindow, loggingStreak, dayBars, shiftDate, weekVerdict } from '../src/shared/trends'
import type { DailyTotals } from '../src/shared/types'

const T = (calories: number, protein = 0): DailyTotals => ({ calories, protein, carbs: 0, fat: 0 })
const TODAY = '2026-07-06'

describe('shiftDate', () => {
  it('shifts across month boundaries', () => {
    expect(shiftDate('2026-07-01', -1)).toBe('2026-06-30')
    expect(shiftDate('2026-06-30', 1)).toBe('2026-07-01')
  })
})

describe('summarizeWindow', () => {
  it('averages logged days only and counts them', () => {
    const m = new Map([
      [TODAY, T(2000, 150)],
      [shiftDate(TODAY, -2), T(1000, 50)]
    ])
    const s = summarizeWindow(m, TODAY, 7)
    expect(s.loggedDays).toBe(2)
    expect(s.windowDays).toBe(7)
    expect(s.avg?.calories).toBe(1500)
    expect(s.avg?.protein).toBe(100)
  })
  it('returns null avg when nothing is logged', () => {
    expect(summarizeWindow(new Map(), TODAY, 7).avg).toBeNull()
  })
  it('ignores days outside the window', () => {
    const m = new Map([[shiftDate(TODAY, -7), T(9000)]]) // 8th day back — outside a 7-day window
    expect(summarizeWindow(m, TODAY, 7).loggedDays).toBe(0)
  })
})

describe('loggingStreak', () => {
  it('counts consecutive days ending today', () => {
    const m = new Map([
      [TODAY, T(1)],
      [shiftDate(TODAY, -1), T(1)],
      [shiftDate(TODAY, -2), T(1)],
      [shiftDate(TODAY, -4), T(1)] // gap at -3 ends the streak
    ])
    expect(loggingStreak(m, TODAY)).toBe(3)
  })
  it("doesn't break at breakfast time: unlogged today falls back to yesterday", () => {
    const m = new Map([
      [shiftDate(TODAY, -1), T(1)],
      [shiftDate(TODAY, -2), T(1)]
    ])
    expect(loggingStreak(m, TODAY)).toBe(2)
  })
  it('is zero when neither today nor yesterday is logged', () => {
    expect(loggingStreak(new Map([[shiftDate(TODAY, -2), T(1)]]), TODAY)).toBe(0)
  })
})

describe('dayBars', () => {
  it('returns n bars oldest→newest, zero-filled for unlogged days', () => {
    const m = new Map([[TODAY, T(1800)]])
    const bars = dayBars(m, TODAY, 14)
    expect(bars).toHaveLength(14)
    expect(bars[13]).toEqual({ date: TODAY, calories: 1800, logged: true })
    expect(bars[0]).toEqual({ date: shiftDate(TODAY, -13), calories: 0, logged: false })
  })
})

describe('weekVerdict', () => {
  const week = (kcals: number[]): Map<string, DailyTotals> =>
    new Map(kcals.map((k, i) => [shiftDate(TODAY, -i), T(k)]))

  it('is steady with no goal', () => {
    expect(weekVerdict(week([2000]), TODAY, null)).toEqual({ verdict: 'steady', daysUnder: 0 })
  })
  it('is on track with ≥5 of 7 days at or under goal×1.05', () => {
    // 5 logged at/under + 2 unlogged (count as under) = 7 under
    const v = weekVerdict(week([2000, 2100, 2400, 2520, 1900]), TODAY, 2400)
    expect(v).toEqual({ verdict: 'on-track', daysUnder: 7 })
  })
  it('is roughly on track when over-goal days crowd the week', () => {
    const v = weekVerdict(week([3000, 3100, 2900, 2800, 2600, 2700, 2900]), TODAY, 2400)
    expect(v.verdict).toBe('roughly')
    expect(v.daysUnder).toBe(0)
  })
  it('treats goal×1.05 as still under (forgiving edge)', () => {
    const v = weekVerdict(week([2520]), TODAY, 2400) // exactly 5% over
    expect(v.daysUnder).toBe(7)
  })
})
