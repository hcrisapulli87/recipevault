export type GoalDirection = 'lose' | 'maintain' | 'gain'
/** Mifflin-St Jeor's two equations — the only place sex enters the maths. */
export type BodySex = 'male' | 'female'

export interface SimpleGoalInputs {
  sex: BodySex
  age: number
  heightCm: number
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
  fibre: number
}

/** NHMRC adequate intake for adults (Nutrient Reference Values for Australia and NZ). */
const FIBRE_AI: Record<BodySex, number> = { female: 25, male: 30 }

export const ACTIVITY_OPTIONS: { value: number; label: string }[] = [
  { value: 1.2, label: 'Mostly sitting' },
  { value: 1.4, label: 'Lightly active' },
  { value: 1.55, label: 'Active' },
  { value: 1.75, label: 'Very active' }
]

export const SEX_OPTIONS: { value: BodySex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' }
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

/** Mifflin-St Jeor's sex constant: +5 for men, −161 for women. */
const SEX_CONSTANT: Record<BodySex, number> = { male: 5, female: -161 }

/**
 * Daily goals from Mifflin-St Jeor — `10·kg + 6.25·cm − 5·age + s` (s = +5 men, −161
 * women) — × activity, ± the direction adjustment, rounded to 50 kcal. Protein 1.8 g/kg,
 * fat 0.9 g/kg, carbs from the remaining calories. A rough guide, not medical advice.
 *
 * The first version fixed every user at a 176 cm man, which over-shot a 165 cm woman's
 * maintenance by roughly 300 kcal a day. Returns null when inputs are missing or
 * implausible.
 */
export function calculateGoalsSimple(i: SimpleGoalInputs): CalculatedGoals | null {
  if (!(i.age >= 10 && i.age <= 120)) return null
  if (!(i.weightKg >= 30 && i.weightKg <= 300)) return null
  if (!(i.heightCm >= 120 && i.heightCm <= 230)) return null
  if (!(i.sex in SEX_CONSTANT)) return null
  if (!(i.activity >= 1 && i.activity <= 2.5)) return null

  const bmr = 10 * i.weightKg + 6.25 * i.heightCm - 5 * i.age + SEX_CONSTANT[i.sex]
  let calories = bmr * i.activity + DIRECTION_ADJUST[i.direction]
  calories = Math.round(calories / 50) * 50
  if (calories <= 0) return null

  const protein = Math.round(1.8 * i.weightKg)
  const fat = Math.round(0.9 * i.weightKg)
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4))
  return { calories, protein, carbs, fat, fibre: FIBRE_AI[i.sex] }
}

/** The calculator's answers, remembered per person in `profiles.body_stats` so the form
 *  comes back filled in. Free-form jsonb, so it is read back defensively. */
export interface BodyStats {
  sex: BodySex | null
  age: number | null
  heightCm: number | null
  weightKg: number | null
  activity: number
  direction: GoalDirection
}

export const DEFAULT_BODY_STATS: BodyStats = {
  sex: null,
  age: null,
  heightCm: null,
  weightKg: null,
  activity: 1.55,
  direction: 'maintain'
}

export function parseBodyStats(raw: unknown): BodyStats {
  if (raw === null || typeof raw !== 'object') return DEFAULT_BODY_STATS
  const r = raw as Record<string, unknown>
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
  return {
    sex: r.sex === 'male' || r.sex === 'female' ? r.sex : null,
    age: num(r.age),
    heightCm: num(r.heightCm),
    weightKg: num(r.weightKg),
    activity: ACTIVITY_OPTIONS.some((o) => o.value === r.activity)
      ? (r.activity as number)
      : DEFAULT_BODY_STATS.activity,
    direction: DIRECTION_OPTIONS.some((o) => o.value === r.direction)
      ? (r.direction as GoalDirection)
      : DEFAULT_BODY_STATS.direction
  }
}
