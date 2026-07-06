export type Sex = 'male' | 'female'
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'veryActive'
export type GoalDirection = 'lose' | 'maintain' | 'gain'

export interface GoalInputs {
  sex: Sex
  age: number
  heightCm: number
  weightKg: number
  activity: ActivityLevel
  direction: GoalDirection
}

export interface CalculatedGoals {
  calories: number
  protein: number
  carbs: number
  fat: number
}

export const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary (little exercise)',
  light: 'Light (exercise 1–3 days/week)',
  moderate: 'Moderate (exercise 3–5 days/week)',
  active: 'Active (exercise 6–7 days/week)',
  veryActive: 'Very active (hard exercise daily / physical job)'
}

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9
}

// Lose = classic ~0.5 kg/week deficit; gain = lean-bulk surplus.
const DIRECTION_ADJUST: Record<GoalDirection, number> = {
  lose: -500,
  maintain: 0,
  gain: 300
}

/**
 * Daily calorie + macro goals from body stats, best-guess estimates:
 * Mifflin-St Jeor BMR × activity factor, then protein at 1.8 g/kg,
 * fat at 27% of calories, carbs from what's left.
 * Returns null when any input is missing or out of a plausible range.
 */
export function calculateGoals(i: GoalInputs): CalculatedGoals | null {
  if (!(i.age >= 10 && i.age <= 120)) return null
  if (!(i.heightCm >= 100 && i.heightCm <= 250)) return null
  if (!(i.weightKg >= 30 && i.weightKg <= 300)) return null

  const bmr = 10 * i.weightKg + 6.25 * i.heightCm - 5 * i.age + (i.sex === 'male' ? 5 : -161)
  const tdee = bmr * ACTIVITY_FACTOR[i.activity]
  const calories = Math.round((tdee + DIRECTION_ADJUST[i.direction]) / 10) * 10
  if (calories <= 0) return null

  const protein = Math.round(1.8 * i.weightKg)
  const fat = Math.round((calories * 0.27) / 9)
  const carbs = Math.round(Math.max(0, calories - protein * 4 - fat * 9) / 4)
  return { calories, protein, carbs, fat }
}
