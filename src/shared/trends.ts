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

export interface WeekVerdict {
  verdict: 'on-track' | 'roughly' | 'steady'
  /** Days of the last 7 at or under goal×1.05 (unlogged days count as under). */
  daysUnder: number
}

/** The Trends verdict: "On track" needs ≥5 of the last 7 days at or under
 *  goal×1.05; without a goal the week is just "steady" (no judgement). */
export function weekVerdict(
  totalsByDate: Map<string, DailyTotals>,
  today: string,
  calGoal: number | null
): WeekVerdict {
  if (!calGoal) return { verdict: 'steady', daysUnder: 0 }
  const daysUnder = dayBars(totalsByDate, today, 7).filter(
    (b) => b.calories <= calGoal * 1.05
  ).length
  return { verdict: daysUnder >= 5 ? 'on-track' : 'roughly', daysUnder }
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

/** Logged days in the window, newest first — the base every window stat reads. */
function loggedDays(
  totalsByDate: Map<string, DailyTotals>,
  today: string,
  days: number
): { date: string; t: DailyTotals }[] {
  const out: { date: string; t: DailyTotals }[] = []
  for (let i = 0; i < days; i++) {
    const date = shiftDate(today, -i)
    const t = totalsByDate.get(date)
    if (t) out.push({ date, t })
  }
  return out
}

export interface HitRate {
  hit: number
  /** logged days in the window — unlogged days are unknown, so they count neither way */
  of: number
}

/** Logged days with protein at or above 90% of the goal — "close enough" counts, the
 *  same forgiving rule the tracker's tiles use. Null without a goal. */
export function proteinHitRate(
  totalsByDate: Map<string, DailyTotals>,
  today: string,
  days: number,
  proteinGoal: number | null
): HitRate | null {
  if (!proteinGoal) return null
  const logged = loggedDays(totalsByDate, today, days)
  return { hit: logged.filter((d) => d.t.protein >= proteinGoal * 0.9).length, of: logged.length }
}

/** Logged days at or under the calorie goal ×1.05 (the verdict's tolerance). */
export function calorieHitRate(
  totalsByDate: Map<string, DailyTotals>,
  today: string,
  days: number,
  calGoal: number | null
): HitRate | null {
  if (!calGoal) return null
  const logged = loggedDays(totalsByDate, today, days)
  return { hit: logged.filter((d) => d.t.calories <= calGoal * 1.05).length, of: logged.length }
}

export interface Standout {
  date: string
  totals: DailyTotals
}

/** The days worth naming in a window: most protein, biggest intake, and — with a calorie
 *  goal — the day that landed closest to it. Today is left out while it is still going. */
export function standoutDays(
  totalsByDate: Map<string, DailyTotals>,
  today: string,
  days: number,
  calGoal: number | null
): { mostProtein: Standout | null; biggest: Standout | null; closest: Standout | null } {
  const logged = loggedDays(totalsByDate, today, days).filter((d) => d.date !== today)
  if (logged.length === 0) return { mostProtein: null, biggest: null, closest: null }
  const pick = (score: (t: DailyTotals) => number): Standout => {
    const best = logged.reduce((a, d) => (score(d.t) > score(a.t) ? d : a))
    return { date: best.date, totals: best.t }
  }
  return {
    mostProtein: pick((t) => t.protein),
    biggest: pick((t) => t.calories),
    closest: calGoal ? pick((t) => -Math.abs(t.calories - calGoal)) : null
  }
}

export interface WeekAverage {
  /** Monday of the week */
  weekStart: string
  avg: DailyTotals | null
  loggedDays: number
}

/** Monday of the week `date` falls in. */
export function weekStartOf(date: string): string {
  const jsDay = new Date(`${date}T00:00:00`).getDay() // 0 = Sunday
  return shiftDate(date, -((jsDay + 6) % 7))
}

/** The last `weeks` Monday-to-Sunday weeks, oldest first, each averaged over its LOGGED
 *  days up to today. The current week is partial and says so through `loggedDays`. */
export function weeklyAverages(
  totalsByDate: Map<string, DailyTotals>,
  today: string,
  weeks: number
): WeekAverage[] {
  const thisMonday = weekStartOf(today)
  const out: WeekAverage[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const weekStart = shiftDate(thisMonday, -7 * w)
    const sum = { calories: 0, protein: 0, carbs: 0, fat: 0 }
    let n = 0
    for (let i = 0; i < 7; i++) {
      const date = shiftDate(weekStart, i)
      if (date > today) break
      const t = totalsByDate.get(date)
      if (!t) continue
      n++
      sum.calories += t.calories
      sum.protein += t.protein
      sum.carbs += t.carbs
      sum.fat += t.fat
    }
    out.push({
      weekStart,
      loggedDays: n,
      avg:
        n === 0
          ? null
          : {
              calories: sum.calories / n,
              protein: sum.protein / n,
              carbs: sum.carbs / n,
              fat: sum.fat / n
            }
    })
  }
  return out
}
