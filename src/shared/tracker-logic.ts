import { MEAL_TYPES } from './types'
import type { DailyTotals, LogEntry, MealType } from './types'

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

/** A log entry with the day it was logged on — the shape the repeat-a-meal lookups read. */
export type DatedLogEntry = LogEntry & { date: string }

/** One earlier meal (or day) worth offering again: when, what, and its energy. */
export interface PastMeal {
  date: string
  entries: LogEntry[]
  calories: number
}

const kcalOf = (entries: LogEntry[]): number =>
  entries.reduce((a, e) => a + e.baseCalories * e.amount, 0)

/**
 * For each meal type, the most recent day BEFORE `date` that had it — so an empty
 * breakfast can offer "same as yesterday's", or Monday's if yesterday was skipped. Entries
 * keep their logged order. Days on or after `date` are ignored.
 */
export function latestMealsBefore(
  rows: DatedLogEntry[],
  date: string
): Partial<Record<MealType, PastMeal>> {
  const out: Partial<Record<MealType, PastMeal>> = {}
  for (const meal of MEAL_TYPES) {
    const earlier = rows.filter((r) => r.mealType === meal && r.date < date)
    if (earlier.length === 0) continue
    const day = earlier.reduce((a, r) => (r.date > a ? r.date : a), earlier[0].date)
    const entries = earlier.filter((r) => r.date === day).map(stripDate)
    out[meal] = { date: day, entries, calories: kcalOf(entries) }
  }
  return out
}

/** The most recent day before `date` with anything logged, every meal included. */
export function latestDayBefore(rows: DatedLogEntry[], date: string): PastMeal | null {
  const earlier = rows.filter((r) => r.date < date)
  if (earlier.length === 0) return null
  const day = earlier.reduce((a, r) => (r.date > a ? r.date : a), earlier[0].date)
  const entries = earlier.filter((r) => r.date === day).map(stripDate)
  return { date: day, entries, calories: kcalOf(entries) }
}

function stripDate(r: DatedLogEntry): LogEntry {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { date, ...entry } = r
  return entry
}

/** "yesterday's" / "Monday's" — how a past day reads in a repeat button. */
export function pastDayLabel(pastDate: string, today: string): string {
  const ms = (d: string): number => new Date(`${d}T00:00:00`).getTime()
  const days = Math.round((ms(today) - ms(pastDate)) / 86_400_000)
  if (days === 1) return 'yesterday’s'
  return `${new Date(`${pastDate}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'long' })}’s`
}
