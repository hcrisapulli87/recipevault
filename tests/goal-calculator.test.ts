import { describe, it, expect } from 'vitest'
import { calculateGoals } from '../src/shared/goal-calculator'
import { macroCalorieShares } from '../src/shared/tracker-logic'

describe('calculateGoals', () => {
  it('computes maintenance goals for a moderately active male', () => {
    // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780; TDEE = 1780 * 1.55 = 2759 → 2760
    expect(
      calculateGoals({
        sex: 'male',
        age: 30,
        heightCm: 180,
        weightKg: 80,
        activity: 'moderate',
        direction: 'maintain'
      })
    ).toEqual({
      calories: 2760,
      protein: 144, // 1.8 g/kg
      fat: 83, // 27% of calories / 9
      carbs: 359 // remainder / 4
    })
  })

  it('applies the weight-loss deficit for a lightly active female', () => {
    // BMR = 10*60 + 6.25*165 - 5*28 - 161 = 1330.25; TDEE = 1829.09; -500 → 1330
    const g = calculateGoals({
      sex: 'female',
      age: 28,
      heightCm: 165,
      weightKg: 60,
      activity: 'light',
      direction: 'lose'
    })
    expect(g?.calories).toBe(1330)
    expect(g?.protein).toBe(108)
  })

  it('adds a surplus when gaining', () => {
    const maintain = calculateGoals({
      sex: 'male',
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: 'moderate',
      direction: 'maintain'
    })
    const gain = calculateGoals({
      sex: 'male',
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: 'moderate',
      direction: 'gain'
    })
    expect(gain!.calories - maintain!.calories).toBe(300)
  })

  it('rejects implausible inputs', () => {
    const base = {
      sex: 'male' as const,
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: 'moderate' as const,
      direction: 'maintain' as const
    }
    expect(calculateGoals({ ...base, age: 0 })).toBeNull()
    expect(calculateGoals({ ...base, heightCm: 30 })).toBeNull()
    expect(calculateGoals({ ...base, weightKg: 0 })).toBeNull()
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
