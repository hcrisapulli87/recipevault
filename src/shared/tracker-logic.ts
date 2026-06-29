import type { DailyTotals, LogEntry } from './types'

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
