import { describe, it, expect } from 'vitest'
import { latestDayBefore, latestMealsBefore, pastDayLabel } from '../src/shared/tracker-logic'
import type { DatedLogEntry } from '../src/shared/tracker-logic'
import type { MealType } from '../src/shared/types'

let nextId = 1
const row = (
  date: string,
  mealType: MealType,
  name: string,
  kcal: number,
  amount = 1
): DatedLogEntry => ({
  id: nextId++,
  date,
  mealType,
  name,
  brand: null,
  amount,
  unit: 'serving',
  baseCalories: kcal,
  baseProtein: 0,
  baseCarbs: 0,
  baseFat: 0,
  baseFibre: null,
  barcode: null,
  source: 'staple'
})

describe('latestMealsBefore', () => {
  const rows = [
    row('2026-10-17', 'breakfast', 'Oats', 300),
    row('2026-10-18', 'breakfast', 'Toast', 200),
    row('2026-10-18', 'breakfast', 'Coffee', 50, 2),
    row('2026-10-16', 'dinner', 'Curry', 600),
    row('2026-10-19', 'breakfast', 'Today’s eggs', 250) // the day itself — never offered
  ]

  it('offers each meal from the most recent earlier day that had it', () => {
    const past = latestMealsBefore(rows, '2026-10-19')
    expect(past.breakfast?.date).toBe('2026-10-18')
    expect(past.breakfast?.entries.map((e) => e.name)).toEqual(['Toast', 'Coffee'])
    expect(past.breakfast?.calories).toBe(300) // 200 + 50×2
    expect(past.dinner?.date).toBe('2026-10-16') // skipped days are looked past
    expect(past.lunch).toBeUndefined()
  })

  it('returns entries without the date field, ready to log again', () => {
    const e = latestMealsBefore(rows, '2026-10-19').breakfast!.entries[0]
    expect(e).not.toHaveProperty('date')
  })
})

describe('latestDayBefore', () => {
  it('takes every meal from the most recent earlier day', () => {
    const rows = [
      row('2026-10-17', 'lunch', 'Wrap', 450),
      row('2026-10-17', 'dinner', 'Pasta', 700),
      row('2026-10-15', 'dinner', 'Old', 100)
    ]
    const day = latestDayBefore(rows, '2026-10-19')!
    expect(day.date).toBe('2026-10-17')
    expect(day.entries.map((e) => e.name)).toEqual(['Wrap', 'Pasta'])
    expect(day.calories).toBe(1150)
  })

  it('is null with nothing earlier', () => {
    expect(latestDayBefore([row('2026-10-19', 'lunch', 'x', 1)], '2026-10-19')).toBeNull()
  })
})

describe('pastDayLabel', () => {
  it('says yesterday’s for the day before, else the weekday', () => {
    expect(pastDayLabel('2026-10-18', '2026-10-19')).toBe('yesterday’s')
    expect(pastDayLabel('2026-10-16', '2026-10-19')).toBe('Friday’s')
  })
})
