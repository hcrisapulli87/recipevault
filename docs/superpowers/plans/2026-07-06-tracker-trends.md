# Tracker Trends View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Trends toggle on the tracker: 7/30-day averages vs goals (logged days only), a logging streak with yesterday-grace, and a last-14-days calorie bar strip.

**Architecture:** Pure window/streak/bars logic in `src/shared/trends.ts`; one ranged `food_log` select aggregated client-side in `data/tracker.ts`; view swap inside `MacroTrackerPage`. No schema change. Spec: `docs/superpowers/specs/2026-07-06-tracker-trends-design.md`.

**Conventions:** Branch `feat/tracker-trends`. TDD for shared + data; UI compiler-verified.

---

### Task 0: Branch
- [ ] `git checkout -b feat/tracker-trends`

### Task 1: Pure trends logic (TDD)

**Files:** Create `src/shared/trends.ts`; test `tests/trends.test.ts`.

- [ ] **1.1** Failing tests:

```ts
import { describe, it, expect } from 'vitest'
import { summarizeWindow, loggingStreak, dayBars, shiftDate } from '../src/shared/trends'
import type { DailyTotals } from '../src/shared/types'

const T = (calories: number, protein = 0): DailyTotals => ({ calories, protein, carbs: 0, fat: 0 })
const TODAY = '2026-07-06'

describe('shiftDate', () => {
  it('shifts across month boundaries', () => {
    expect(shiftDate('2026-07-01', -1)).toBe('2026-06-30')
    expect(shiftDate('2026-06-30', 1)).toBe('2026-07-01')
  })
})

describe('summarizeWindow', () => {
  it('averages logged days only and counts them', () => {
    const m = new Map([
      [TODAY, T(2000, 150)],
      [shiftDate(TODAY, -2), T(1000, 50)]
    ])
    const s = summarizeWindow(m, TODAY, 7)
    expect(s.loggedDays).toBe(2)
    expect(s.windowDays).toBe(7)
    expect(s.avg?.calories).toBe(1500)
    expect(s.avg?.protein).toBe(100)
  })
  it('returns null avg when nothing is logged', () => {
    expect(summarizeWindow(new Map(), TODAY, 7).avg).toBeNull()
  })
  it('ignores days outside the window', () => {
    const m = new Map([[shiftDate(TODAY, -7), T(9000)]]) // 8th day back — outside a 7-day window
    expect(summarizeWindow(m, TODAY, 7).loggedDays).toBe(0)
  })
})

describe('loggingStreak', () => {
  it('counts consecutive days ending today', () => {
    const m = new Map([
      [TODAY, T(1)],
      [shiftDate(TODAY, -1), T(1)],
      [shiftDate(TODAY, -2), T(1)],
      [shiftDate(TODAY, -4), T(1)] // gap at -3 ends the streak
    ])
    expect(loggingStreak(m, TODAY)).toBe(3)
  })
  it("doesn't break at breakfast time: unlogged today falls back to yesterday", () => {
    const m = new Map([
      [shiftDate(TODAY, -1), T(1)],
      [shiftDate(TODAY, -2), T(1)]
    ])
    expect(loggingStreak(m, TODAY)).toBe(2)
  })
  it('is zero when neither today nor yesterday is logged', () => {
    expect(loggingStreak(new Map([[shiftDate(TODAY, -2), T(1)]]), TODAY)).toBe(0)
  })
})

describe('dayBars', () => {
  it('returns n bars oldest→newest, zero-filled for unlogged days', () => {
    const m = new Map([[TODAY, T(1800)]])
    const bars = dayBars(m, TODAY, 14)
    expect(bars).toHaveLength(14)
    expect(bars[13]).toEqual({ date: TODAY, calories: 1800, logged: true })
    expect(bars[0]).toEqual({ date: shiftDate(TODAY, -13), calories: 0, logged: false })
  })
})
```

- [ ] **1.2** Run failing → implement `src/shared/trends.ts`:

```ts
import type { DailyTotals } from './types'

/** ISO date maths without Date-timezone traps (local midnight anchored). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
```

- [ ] **1.3** PASS (8 tests) → commit `feat(trends): pure window/streak/bars logic`

### Task 2: Ranged totals fetch (TDD)

**Files:** Modify `src/renderer/data/tracker.ts`; test `tests/data-tracker-range.test.ts`.

- [ ] **2.1** Failing test (own mock file — the existing data-tracker mock isn't range-aware):

```ts
import { describe, it, expect, vi } from 'vitest'
import { getDailyTotalsRange } from '../src/renderer/data/tracker'

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], filters: [] as unknown[] }))
vi.mock('../src/renderer/data/supabase', () => {
  const chain = (data: unknown): Record<string, unknown> => {
    const node: Record<string, unknown> = {
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok)
    }
    for (const m of ['select', 'eq', 'gte', 'lte', 'order']) {
      node[m] = (...args: unknown[]) => {
        state.filters.push([m, ...args])
        return chain(data)
      }
    }
    return node
  }
  return { supabase: { from: () => chain(state.rows) } }
})

describe('getDailyTotalsRange', () => {
  it('aggregates base×amount per day into a Map', async () => {
    state.rows = [
      { log_date: '2026-07-05', amount: 2, base_calories: 150, base_protein: 5, base_carbs: 27, base_fat: 3 },
      { log_date: '2026-07-05', amount: 1, base_calories: 200, base_protein: 40, base_carbs: 0, base_fat: 4 },
      { log_date: '2026-07-06', amount: 1, base_calories: 300, base_protein: 10, base_carbs: 30, base_fat: 10 }
    ]
    const map = await getDailyTotalsRange('user-1', '2026-06-07', '2026-07-06')
    expect(map.size).toBe(2)
    expect(map.get('2026-07-05')).toEqual({ calories: 500, protein: 50, carbs: 54, fat: 10 })
    expect(map.get('2026-07-06')).toEqual({ calories: 300, protein: 10, carbs: 30, fat: 10 })
    expect(state.filters).toContainEqual(['eq', 'owner_id', 'user-1'])
    expect(state.filters).toContainEqual(['gte', 'log_date', '2026-06-07'])
    expect(state.filters).toContainEqual(['lte', 'log_date', '2026-07-06'])
  })
})
```

- [ ] **2.2** Implement in `tracker.ts`:

```ts
/** Per-day totals over a date range (inclusive), for the Trends view.
 *  One query; aggregation client-side. RLS household-read covers partner ids. */
export async function getDailyTotalsRange(
  ownerId: string,
  from: string,
  to: string
): Promise<Map<string, DailyTotals>> {
  const { data, error } = await supabase
    .from('food_log')
    .select('log_date, amount, base_calories, base_protein, base_carbs, base_fat')
    .eq('owner_id', ownerId)
    .gte('log_date', from)
    .lte('log_date', to)
  if (error) throw new Error(error.message)
  const map = new Map<string, DailyTotals>()
  for (const r of data ?? []) {
    const t = map.get(r.log_date) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 }
    t.calories += r.base_calories * r.amount
    t.protein += r.base_protein * r.amount
    t.carbs += r.base_carbs * r.amount
    t.fat += r.base_fat * r.amount
    map.set(r.log_date, t)
  }
  return map
}
```

(import `DailyTotals` if not present.)

- [ ] **2.3** PASS + full suite green → commit `feat(tracker): ranged per-day totals for trends`

### Task 3: Trends view UI

**Files:** Modify `src/renderer/pages/MacroTrackerPage.tsx`, `src/renderer/styles.css`.

- [ ] **3.1** Page state `view: 'today' | 'trends'`; header button (next to Goals, also visible read-only):

```tsx
<button className="btn" onClick={() => setView(view === 'today' ? 'trends' : 'today')}>
  {view === 'today' ? '📈 Trends' : '📅 Today'}
</button>
```

When `view === 'trends'`, load 30 days once per user via `getDailyTotalsRange(current.id, shiftDate(todayStr(), -29), todayStr())` (refresh on `food_log` realtime, same stale-guard). Render `<TrendsView totals={rangeTotals} goals={goals} />` in place of date-nav + hero + meals (keep header + person switcher).

- [ ] **3.2** `TrendsView` component (in the same file — page-local):

```tsx
function TrendsView(props: {
  totals: Map<string, DailyTotals>
  goals: DailyLog['goals']
}): JSX.Element {
  const today = todayStr()
  const streak = loggingStreak(props.totals, today)
  const bars = dayBars(props.totals, today, 14)
  const calGoal = props.goals.calories
  const maxBar = Math.max(calGoal ? calGoal * 1.5 : 0, ...bars.map((b) => b.calories), 1)
  return (
    <div className="trends">
      {streak > 1 && <p className="trends__streak">🔥 {streak}-day logging streak</p>}
      <div className="trends__cards">
        {[7, 30].map((days) => {
          const s = summarizeWindow(props.totals, today, days)
          return (
            <div key={days} className="trends__card">
              <span className="trends__card-title">Last {days} days</span>
              {s.avg ? (
                <>
                  <span className="trends__card-line">
                    {Math.round(s.avg.calories).toLocaleString()} kcal/day
                    {calGoal ? ` · goal ${Math.round(calGoal).toLocaleString()}` : ''}
                  </span>
                  <span className="trends__card-line">
                    P {Math.round(s.avg.protein)} g/day
                    {props.goals.protein ? ` · goal ${Math.round(props.goals.protein)}` : ''}
                  </span>
                </>
              ) : (
                <span className="trends__card-line">nothing logged</span>
              )}
              <span className="trends__card-meta">
                logged {s.loggedDays} of {s.windowDays} days
              </span>
            </div>
          )
        })}
      </div>
      <div className="trends__bars">
        {bars.map((b) => (
          <div key={b.date} className="trends__bar-col" title={`${b.date}: ${Math.round(b.calories)} kcal`}>
            <div className="trends__bar-track">
              <div
                className={`trends__bar-fill ${
                  calGoal && b.calories > calGoal ? 'trends__bar-fill--over' : ''
                }`}
                style={{ height: `${Math.min(100, (b.calories / maxBar) * 100)}%` }}
              />
            </div>
            <span className={`trends__bar-day ${b.date === today ? 'trends__bar-day--today' : ''}`}>
              {'MTWTFSS'[(new Date(b.date + 'T00:00:00').getDay() + 6) % 7]}
            </span>
          </div>
        ))}
      </div>
      <p className="plan-note">
        Averages count logged days only — a day you didn't log isn't a 0-calorie day.
      </p>
    </div>
  )
}
```

(imports: `summarizeWindow, loggingStreak, dayBars, shiftDate` from `../../shared/trends`.)

- [ ] **3.3** CSS (after the tracker/hero rules):

```css
/* Trends view */
.trends { display: flex; flex-direction: column; gap: 16px; max-width: 720px; }
.trends__streak { font-weight: 600; }
.trends__cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.trends__card {
  background: var(--bg-surface); border: 1px solid var(--border);
  border-radius: var(--radius); box-shadow: var(--shadow-sm);
  padding: 12px 14px; display: flex; flex-direction: column; gap: 3px;
}
.trends__card-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: var(--text-muted); }
.trends__card-line { font-size: 14px; font-weight: 600; }
.trends__card-meta { font-size: 11px; color: var(--text-muted); }
.trends__bars { display: flex; gap: 6px; align-items: flex-end; }
.trends__bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.trends__bar-track { height: 110px; width: 100%; max-width: 26px; background: var(--bg-elevated); border-radius: 6px; display: flex; align-items: flex-end; overflow: hidden; }
.trends__bar-fill { width: 100%; background: var(--accent); border-radius: 6px 6px 0 0; }
.trends__bar-fill--over { background: var(--red); }
.trends__bar-day { font-size: 9px; color: var(--text-muted); }
.trends__bar-day--today { color: var(--accent-deep); font-weight: 700; }
@media (max-width: 720px) { .trends__cards { grid-template-columns: 1fr; } }
```

- [ ] **3.4** Typecheck + suite green → commit `feat(tracker): trends view - averages, streak, 14-day bars`

### Task 4: Verify + finish
- [ ] Full verification (typecheck, vitest, lint 0 errors, build:web, electron build) → ff-merge → plain push (no schema) → bundle-flip deploy check.
