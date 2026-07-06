import type { DailyTotals } from './types'

/** ISO date maths without Date-timezone traps (local midnight anchored). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

export interface WindowSummary {
  avg: DailyTotals | null
  loggedDays: number
  windowDays: number
}

/** Average over LOGGED days only — an unlogged day is unknown, not zero kcal. */
export function summarizeWindow(
  totalsByDate: Map<string, DailyTotals>,
  today: string,
  days: number
): WindowSummary {
  let logged = 0
  const sum = { calories: 0, protein: 0, carbs: 0, fat: 0 }
  for (let i = 0; i < days; i++) {
    const t = totalsByDate.get(shiftDate(today, -i))
    if (!t) continue
    logged++
    sum.calories += t.calories
    sum.protein += t.protein
    sum.carbs += t.carbs
    sum.fat += t.fat
  }
  return {
    avg:
      logged === 0
        ? null
        : {
            calories: sum.calories / logged,
            protein: sum.protein / logged,
            carbs: sum.carbs / logged,
            fat: sum.fat / logged
          },
    loggedDays: logged,
    windowDays: days
  }
}

/** Consecutive logged days ending today — or yesterday, so an unlogged
 *  morning doesn't zero the streak. */
export function loggingStreak(totalsByDate: Map<string, DailyTotals>, today: string): number {
  const start = totalsByDate.has(today) ? today : shiftDate(today, -1)
  let streak = 0
  for (let d = start; totalsByDate.has(d); d = shiftDate(d, -1)) streak++
  return streak
}

export interface DayBar {
  date: string
  calories: number
  logged: boolean
}

/** Last n days oldest→newest, zero-filled — the view scales/colours them. */
export function dayBars(
  totalsByDate: Map<string, DailyTotals>,
  today: string,
  n: number
): DayBar[] {
  const out: DayBar[] = []
  for (let i = n - 1; i >= 0; i--) {
    const date = shiftDate(today, -i)
    const t = totalsByDate.get(date)
    out.push({ date, calories: t?.calories ?? 0, logged: t !== undefined })
  }
  return out
}
