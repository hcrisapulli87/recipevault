export type GoalDirection = 'lose' | 'maintain' | 'gain'

export interface SimpleGoalInputs {
  age: number
  weightKg: number
  /** Mifflin-St Jeor activity multiplier: 1.2 / 1.4 / 1.55 / 1.75 */
  activity: number
  direction: GoalDirection
}

export interface CalculatedGoals {
  calories: number
  protein: number
  carbs: number
  fat: number
}

export const ACTIVITY_OPTIONS: { value: number; label: string }[] = [
  { value: 1.2, label: 'Mostly sitting' },
  { value: 1.4, label: 'Lightly active' },
  { value: 1.55, label: 'Active' },
  { value: 1.75, label: 'Very active' }
]

export const DIRECTION_OPTIONS: { value: GoalDirection; label: string }[] = [
  { value: 'lose', label: 'Lose slowly' },
  { value: 'maintain', label: 'Maintain' },
  { value: 'gain', label: 'Build' }
]

// Lose = gentle ~0.45 kg/week deficit; gain = lean-bulk surplus.
const DIRECTION_ADJUST: Record<GoalDirection, number> = {
  lose: -450,
  maintain: 0,
  gain: 300
}

/**
 * Spec-simple daily goals (glass redesign): Mifflin-St Jeor with a fixed
 * 176 cm male baseline — `10·w + 6.25·176 − 5·age + 5` — × activity, ± the
 * direction adjustment, rounded to 50 kcal. Protein 1.8 g/kg, fat 0.9 g/kg,
 * carbs from the remaining calories. A rough guide, not medical advice.
 * Returns null when inputs are missing or implausible.
 */
export function calculateGoalsSimple(i: SimpleGoalInputs): CalculatedGoals | null {
  if (!(i.age >= 10 && i.age <= 120)) return null
  if (!(i.weightKg >= 30 && i.weightKg <= 300)) return null
  if (!(i.activity >= 1 && i.activity <= 2.5)) return null

  const bmr = 10 * i.weightKg + 6.25 * 176 - 5 * i.age + 5
  let calories = bmr * i.activity + DIRECTION_ADJUST[i.direction]
  calories = Math.round(calories / 50) * 50
  if (calories <= 0) return null

  const protein = Math.round(1.8 * i.weightKg)
  const fat = Math.round(0.9 * i.weightKg)
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4))
  return { calories, protein, carbs, fat }
}
