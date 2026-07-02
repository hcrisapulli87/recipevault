import { describe, it, expect } from 'vitest'
import { computeTotals } from '../src/shared/tracker-logic'
import type { LogEntry } from '../src/shared/types'

describe('computeTotals', () => {
  it('sums per-unit macros times amount', () => {
    const entries: LogEntry[] = [
      {
        id: 1,
        mealType: 'breakfast',
        name: 'A',
        brand: null,
        amount: 1.5,
        unit: '100g',
        baseCalories: 100,
        baseProtein: 8,
        baseCarbs: 4,
        baseFat: 2,
        barcode: null,
        source: 'search'
      },
      {
        id: 2,
        mealType: 'snack',
        name: 'B',
        brand: null,
        amount: 2,
        unit: 'serving',
        baseCalories: 50,
        baseProtein: 1,
        baseCarbs: 10,
        baseFat: 0,
        barcode: null,
        source: 'manual'
      }
    ]
    expect(computeTotals(entries)).toEqual({ calories: 250, protein: 14, carbs: 26, fat: 3 })
  })

  it('returns zeros for an empty day', () => {
    expect(computeTotals([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  })
})
