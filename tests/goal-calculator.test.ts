import { describe, it, expect } from 'vitest'
import {
  calculateGoalsSimple,
  parseBodyStats,
  DEFAULT_BODY_STATS
} from '../src/shared/goal-calculator'
import { macroCalorieShares } from '../src/shared/tracker-logic'

describe('calculateGoalsSimple', () => {
  const man = { sex: 'male', heightCm: 176 } as const

  it('computes maintenance goals from Mifflin-St Jeor (man, 176 cm, 82 kg, 31 y, active)', () => {
    // BMR = 10*82 + 6.25*176 - 5*31 + 5 = 1770; ×1.55 = 2743.5 → round to 50 = 2750
    expect(
      calculateGoalsSimple({ ...man, age: 31, weightKg: 82, activity: 1.55, direction: 'maintain' })
    ).toEqual({
      calories: 2750,
      protein: 148, // 1.8 g/kg
      fat: 74, // 0.9 g/kg
      carbs: Math.round((2750 - 148 * 4 - 74 * 9) / 4),
      fibre: 30 // NHMRC adequate intake, men
    })
  })

  it('applies −450 for losing and +300 for building, rounded to 50', () => {
    const base = { ...man, age: 31, weightKg: 82, activity: 1.55 } as const
    const maintain = calculateGoalsSimple({ ...base, direction: 'maintain' })!
    const lose = calculateGoalsSimple({ ...base, direction: 'lose' })!
    const gain = calculateGoalsSimple({ ...base, direction: 'gain' })!
    expect(maintain.calories - lose.calories).toBe(450)
    expect(gain.calories - maintain.calories).toBe(300)
    expect(lose.calories % 50).toBe(0)
    expect(gain.calories % 50).toBe(0)
  })

  it('keeps protein and fat per-kg regardless of direction', () => {
    const lose = calculateGoalsSimple({
      sex: 'female',
      heightCm: 165,
      age: 28,
      weightKg: 60,
      activity: 1.4,
      direction: 'lose'
    })!
    expect(lose.protein).toBe(108) // 1.8 × 60
    expect(lose.fat).toBe(54) // 0.9 × 60
  })

  it('uses the woman’s equation and her real height', () => {
    // BMR = 10*60 + 6.25*165 - 5*28 - 161 = 1330.25; ×1.4 = 1862.35 → 1850
    const her = calculateGoalsSimple({
      sex: 'female',
      heightCm: 165,
      age: 28,
      weightKg: 60,
      activity: 1.4,
      direction: 'maintain'
    })!
    expect(her.calories).toBe(1850)
    expect(her.fibre).toBe(25) // NHMRC adequate intake, women
    // The old fixed 176 cm man gave 10*60 + 1100 - 140 + 5 = 1565 × 1.4 = 2191 → 2200.
    expect(2200 - her.calories).toBeGreaterThanOrEqual(300)
  })

  it('rejects implausible inputs', () => {
    const base = { ...man, age: 31, weightKg: 82, activity: 1.55, direction: 'maintain' as const }
    expect(calculateGoalsSimple({ ...base, heightCm: 0 })).toBeNull()
    expect(calculateGoalsSimple({ ...base, heightCm: 400 })).toBeNull()
    expect(calculateGoalsSimple({ ...base, age: 0 })).toBeNull()
    expect(calculateGoalsSimple({ ...base, weightKg: 0 })).toBeNull()
    expect(calculateGoalsSimple({ ...base, activity: 9 })).toBeNull()
  })
})

describe('parseBodyStats', () => {
  it('reads stored answers back', () => {
    expect(
      parseBodyStats({
        sex: 'female',
        age: 30,
        heightCm: 165,
        weightKg: 62,
        activity: 1.4,
        direction: 'lose'
      })
    ).toEqual({
      sex: 'female',
      age: 30,
      heightCm: 165,
      weightKg: 62,
      activity: 1.4,
      direction: 'lose'
    })
  })

  it('falls back field by field on missing or garbled values', () => {
    expect(parseBodyStats(null)).toEqual(DEFAULT_BODY_STATS)
    expect(parseBodyStats({ sex: 'x', age: -3, activity: 7, direction: 'sideways' })).toEqual(
      DEFAULT_BODY_STATS
    )
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
