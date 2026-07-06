import { describe, it, expect } from 'vitest'
import { summarizeWindow, loggingStreak, dayBars, shiftDate } from '../src/shared/trends'
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
