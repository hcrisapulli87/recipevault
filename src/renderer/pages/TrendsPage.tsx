import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DailyTotals, DailyLog } from '../../shared/types'
import { dayBars, shiftDate, summarizeWindow, weekVerdict } from '../../shared/trends'
import { getDailyLog, getDailyTotalsRange } from '../data/tracker'
import { onTableChange } from '../data/realtime'
import type { HouseholdUser } from '../data/users'

function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

const VERDICT_LABEL = {
  'on-track': 'On track',
  roughly: 'Roughly on track',
  steady: 'Steady week'
} as const

/** Last-7-days view: verdict island with the bar chart, three stat tiles. */
export function TrendsPage(props: { current: HouseholdUser | null }): JSX.Element {
  const { current } = props
  const [totals, setTotals] = useState<Map<string, DailyTotals> | null>(null)
  const [goals, setGoals] = useState<DailyLog['goals'] | null>(null)
  const today = isoToday()

  // Only the response for the person still selected may land.
  const viewRef = useRef('')
  useEffect(() => {
    viewRef.current = current?.id ?? ''
  })

  const reload = useCallback((): void => {
    if (!current) return
    const forId = current.id
    getDailyTotalsRange(forId, shiftDate(today, -6), today).then((m) => {
      if (viewRef.current === forId) setTotals(m)
    })
    getDailyLog(today, { id: current.id, isMe: current.isMe }).then((l) => {
      if (viewRef.current === forId) setGoals(l.goals)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, today])

  useEffect(() => {
    reload()
    return onTableChange(['food_log', 'profiles'], reload)
  }, [reload])

  const calGoal = goals?.calories ?? null
  const bars = totals ? dayBars(totals, today, 7) : []
  const { verdict, daysUnder } = weekVerdict(totals ?? new Map(), today, calGoal)
  const summary = totals ? summarizeWindow(totals, today, 7) : null
  const maxK = Math.max(...bars.map((b) => b.calories), calGoal ?? 0, 1) * 1.12
  const avgKcal = summary?.avg ? Math.round(summary.avg.calories) : 0

  const verdictSub = calGoal
    ? `${daysUnder} of 7 days at or under goal (${Math.round(calGoal).toLocaleString()} kcal)`
    : `No goal set — weekly average ${avgKcal.toLocaleString()} kcal`

  return (
    <div className="trends">
      <div className="trends__title">Trends</div>
      <div className="trends__meta">
        Last 7 days · {current?.name ?? '…'} · estimates
      </div>

      <div className="trends__verdict glass-island">
        <div className="trends__verdict-line">{VERDICT_LABEL[verdict]}</div>
        <div className="trends__verdict-sub">{verdictSub}</div>
        <div className="trends__chart">
          {calGoal != null && (
            <div
              className="trends__goal-line"
              style={{ bottom: `${Math.round((calGoal / maxK) * 100)}%` }}
            />
          )}
          {bars.map((b) => {
            const isToday = b.date === today
            const over = calGoal != null && b.calories > calGoal * 1.05
            return (
              <div key={b.date} className="trends__bar-col">
                <span className="trends__bar-kcal">
                  {b.logged || isToday ? `${(b.calories / 1000).toFixed(1)}k` : '–'}
                </span>
                <div
                  className="trends__bar"
                  style={{
                    height: `${Math.max(6, Math.round((b.calories / maxK) * 100))}%`,
                    background: isToday ? 'var(--accent)' : over ? 'var(--over-trend)' : '#c3cbd1'
                  }}
                />
              </div>
            )
          })}
        </div>
        <div className="trends__days">
          {bars.map((b) => {
            const isToday = b.date === today
            const label = isToday
              ? 'TODAY'
              : new Date(b.date + 'T00:00:00')
                  .toLocaleDateString(undefined, { weekday: 'short' })
                  .toUpperCase()
            return (
              <span
                key={b.date}
                className={`trends__day ${isToday ? 'trends__day--today' : ''}`}
              >
                {label}
              </span>
            )
          })}
        </div>
      </div>

      <div className="trends__stats">
        <div className="trends__stat glass-island">
          <div className="trends__stat-label">Avg kcal</div>
          <div className="trends__stat-value">{avgKcal.toLocaleString()}</div>
        </div>
        <div className="trends__stat glass-island">
          <div className="trends__stat-label">Avg protein</div>
          <div className="trends__stat-value">
            {summary?.avg ? Math.round(summary.avg.protein) : 0} g
          </div>
        </div>
        <div className="trends__stat glass-island">
          <div className="trends__stat-label">Days logged</div>
          <div className="trends__stat-value">{summary?.loggedDays ?? 0} / 7</div>
        </div>
      </div>

      <p className="trends__footer">
        Daily totals are best-guess estimates from an open food database — read them as a weekly
        shape, not a lab report.
      </p>
    </div>
  )
}
