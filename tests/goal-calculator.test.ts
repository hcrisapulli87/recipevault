import { describe, it, expect } from 'vitest'
import { calculateGoalsSimple } from '../src/shared/goal-calculator'
import { macroCalorieShares } from '../src/shared/tracker-logic'

describe('calculateGoalsSimple', () => {
  it('computes maintenance goals from the spec formula (82 kg, 31 y, active)', () => {
    // BMR = 10*82 + 6.25*176 - 5*31 + 5 = 1770; ×1.55 = 2743.5 → round to 50 = 2750
    expect(
      calculateGoalsSimple({ age: 31, weightKg: 82, activity: 1.55, direction: 'maintain' })
    ).toEqual({
      calories: 2750,
      protein: 148, // 1.8 g/kg
      fat: 74, // 0.9 g/kg
      carbs: Math.round((2750 - 148 * 4 - 74 * 9) / 4)
    })
  })

  it('applies −450 for losing and +300 for building, rounded to 50', () => {
    const base = { age: 31, weightKg: 82, activity: 1.55 } as const
    const maintain = calculateGoalsSimple({ ...base, direction: 'maintain' })!
    const lose = calculateGoalsSimple({ ...base, direction: 'lose' })!
    const gain = calculateGoalsSimple({ ...base, direction: 'gain' })!
    expect(maintain.calories - lose.calories).toBe(450)
    expect(gain.calories - maintain.calories).toBe(300)
    expect(lose.calories % 50).toBe(0)
    expect(gain.calories % 50).toBe(0)
  })

  it('keeps protein and fat per-kg regardless of direction', () => {
    const lose = calculateGoalsSimple({ age: 28, weightKg: 60, activity: 1.4, direction: 'lose' })!
    expect(lose.protein).toBe(108) // 1.8 × 60
    expect(lose.fat).toBe(54) // 0.9 × 60
  })

  it('rejects implausible inputs', () => {
    const base = { age: 31, weightKg: 82, activity: 1.55, direction: 'maintain' as const }
    expect(calculateGoalsSimple({ ...base, age: 0 })).toBeNull()
    expect(calculateGoalsSimple({ ...base, weightKg: 0 })).toBeNull()
    expect(calculateGoalsSimple({ ...base, activity: 9 })).toBeNull()
  })
})

describe('macroCalorieShares', () => {
  it('splits by calorie contribution (fat counts 9 kcal/g)', () => {
    // P 100g = 400 kcal, C 100g = 400 kcal, F 100g = 900 kcal → total 1700
    const s = macroCalorieShares({ calories: 1700, protein: 100, carbs: 100, fat: 100 })
    expect(s.protein).toBeCloseTo((400 / 1700) * 100)
    expect(s.carbs).toBeCloseTo((400 / 1700) * 100)
    expect(s.fat).toBeCloseTo((900 / 1700) * 100)
  })

  it('returns zeros for an empty day', () =>
    expect(macroCalorieShares({ calories: 0, protein: 0, carbs: 0, fat: 0 })).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0
    }))
})
