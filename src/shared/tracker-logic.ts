import type { DailyTotals, LogEntry } from './types'

/**
 * Each macro's share of the day's energy (protein/carbs 4 kcal/g, fat 9), as 0–100
 * percentages. Drives the macro bars when no goals are set — the bars then read as
 * "today's macro split" instead of progress toward a target.
 */
export function macroCalorieShares(t: DailyTotals): {
  protein: number
  carbs: number
  fat: number
} {
  const p = t.protein * 4
  const c = t.carbs * 4
  const f = t.fat * 9
  const total = p + c + f
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 }
  return { protein: (p / total) * 100, carbs: (c / total) * 100, fat: (f / total) * 100 }
}

/** Sum the macros actually consumed (per-unit macros × amount) across entries. */
export function computeTotals(entries: LogEntry[]): DailyTotals {
  return entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.baseCalories * e.amount,
      protein: acc.protein + e.baseProtein * e.amount,
      carbs: acc.carbs + e.baseCarbs * e.amount,
      fat: acc.fat + e.baseFat * e.amount
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  )
}
