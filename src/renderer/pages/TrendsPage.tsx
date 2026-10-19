import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DailyTotals, DailyLog } from '../../shared/types'
import {
  calorieHitRate,
  dayBars,
  proteinHitRate,
  shiftDate,
  standoutDays,
  summarizeWindow,
  weekVerdict,
  weeklyAverages
} from '../../shared/trends'
import type { HitRate, Standout } from '../../shared/trends'
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

type Range = 7 | 30 | 90
const RANGES: Range[] = [7, 30, 90]
/** 90 days reads as ~13 weekly bars; daily bars at that width are noise. */
const WEEKS_FOR_90 = 13

const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
const dayAndDate = (iso: string): string =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })

/** One chart bar, whatever it stands for (a day, or a week's average). */
interface Bar {
  key: string
  value: number
  logged: boolean
  highlight: boolean
  label: string
  /** the small figure above the bar — only drawn when the bars are wide enough */
  caption: string | null
}

function HitTile(props: { label: string; rate: HitRate | null; unset: string }): JSX.Element {
  const { rate } = props
  const pct = rate && rate.of > 0 ? Math.round((rate.hit / rate.of) * 100) : 0
  return (
    <div className="trends__stat glass-island">
      <div className="trends__stat-label">{props.label}</div>
      {rate === null ? (
        <div className="trends__stat-note">{props.unset}</div>
      ) : (
        <>
          <div className="trends__stat-value">
            {rate.hit}
            <span className="trends__stat-of"> / {rate.of} days</span>
          </div>
          <div className="trends__hit-track">
            <div className="trends__hit-fill" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  )
}

function StandoutRow(props: {
  label: string
  day: Standout | null
  value: string
}): JSX.Element | null {
  if (!props.day) return null
  return (
    <div className="trends__standout">
      <span className="trends__standout-label">{props.label}</span>
      <span className="trends__standout-day">{dayAndDate(props.day.date)}</span>
      <span className="trends__standout-value">{props.value}</span>
    </div>
  )
}

/** 7 / 30 / 90-day view: verdict island with the bar chart, averages, goal hit rates,
 *  standout days and (on the longer ranges) a weekly breakdown. All read-only over food_log. */
export function TrendsPage(props: { current: HouseholdUser | null }): JSX.Element {
  const { current } = props
  const [range, setRange] = useState<Range>(7)
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
    // One fetch covers every range; switching ranges is then instant.
    getDailyTotalsRange(forId, shiftDate(today, -(7 * WEEKS_FOR_90 - 1)), today).then((m) => {
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

  const data = totals ?? new Map<string, DailyTotals>()
  const calGoal = goals?.calories ?? null
  const proteinGoal = goals?.protein ?? null
  const summary = summarizeWindow(data, today, range)
  const avgKcal = summary.avg ? Math.round(summary.avg.calories) : 0
  const avgProtein = summary.avg ? Math.round(summary.avg.protein) : 0
  const calRate = calorieHitRate(data, today, range, calGoal)
  const proteinRate = proteinHitRate(data, today, range, proteinGoal)
  const standouts = standoutDays(data, today, range, calGoal)
  const weeks = range === 7 ? [] : weeklyAverages(data, today, range === 30 ? 5 : WEEKS_FOR_90)

  const bars: Bar[] =
    range === 90
      ? weeks.map((w) => ({
          key: w.weekStart,
          value: w.avg?.calories ?? 0,
          logged: w.avg !== null,
          highlight: w.weekStart === weeks[weeks.length - 1].weekStart,
          label: shortDate(w.weekStart),
          caption: null
        }))
      : dayBars(data, today, range).map((b) => ({
          key: b.date,
          value: b.calories,
          logged: b.logged,
          highlight: b.date === today,
          label:
            b.date === today
              ? 'TODAY'
              : new Date(`${b.date}T00:00:00`)
                  .toLocaleDateString(undefined, { weekday: 'short' })
                  .toUpperCase(),
          caption:
            range === 7 && (b.logged || b.date === today)
              ? `${(b.calories / 1000).toFixed(1)}k`
              : range === 7
                ? '–'
                : null
        }))
  const maxK = Math.max(...bars.map((b) => b.value), calGoal ?? 0, 1) * 1.12
  // With 30 or 13 bars, only a few labels fit under the chart.
  const labelEvery = range === 7 ? 1 : range === 30 ? 7 : 4

  let headline: string
  let headlineSub: string
  if (range === 7) {
    const { verdict, daysUnder } = weekVerdict(data, today, calGoal)
    headline = VERDICT_LABEL[verdict]
    headlineSub = calGoal
      ? `${daysUnder} of 7 days at or under goal (${Math.round(calGoal).toLocaleString()} kcal)`
      : `No goal set — weekly average ${avgKcal.toLocaleString()} kcal`
  } else {
    headline = summary.avg ? `${avgKcal.toLocaleString()} kcal a day` : 'Nothing logged yet'
    headlineSub = calGoal
      ? `Average over ${summary.loggedDays} logged days · goal ${Math.round(calGoal).toLocaleString()} kcal`
      : `Average over ${summary.loggedDays} logged days`
  }

  return (
    <div className="trends">
      <div className="trends__title">Trends</div>
      <div className="trends__meta">
        Last {range} days · {current?.name ?? '…'} · estimates
      </div>

      <div className="segmented" role="tablist" aria-label="Range">
        {RANGES.map((r) => (
          <button
            key={r}
            role="tab"
            aria-selected={range === r}
            className={`segmented__btn ${range === r ? 'segmented__btn--on' : ''}`}
            onClick={() => setRange(r)}
          >
            {r} days
          </button>
        ))}
      </div>

      <div className="trends__verdict glass-island">
        <div className="trends__verdict-line">{headline}</div>
        <div className="trends__verdict-sub">{headlineSub}</div>
        <div className={`trends__chart ${range !== 7 ? 'trends__chart--dense' : ''}`}>
          {calGoal != null && (
            <div
              className="trends__goal-line"
              style={{ bottom: `${Math.round((calGoal / maxK) * 100)}%` }}
            />
          )}
          {bars.map((b) => {
            const over = calGoal != null && b.value > calGoal * 1.05
            return (
              <div key={b.key} className="trends__bar-col">
                {b.caption !== null && <span className="trends__bar-kcal">{b.caption}</span>}
                <div
                  className="trends__bar"
                  title={`${b.label} · ${Math.round(b.value).toLocaleString()} kcal`}
                  style={{
                    height: b.logged ? `${Math.max(6, Math.round((b.value / maxK) * 100))}%` : '3%',
                    background: b.highlight
                      ? 'var(--accent)'
                      : over
                        ? 'var(--over-trend)'
                        : '#c3cbd1',
                    opacity: b.logged || b.highlight ? 1 : 0.45
                  }}
                />
              </div>
            )
          })}
        </div>
        <div className={`trends__days ${range !== 7 ? 'trends__days--dense' : ''}`}>
          {bars.map((b, i) => {
            // Label from the newest bar backwards so the last one is always named.
            const show = (bars.length - 1 - i) % labelEvery === 0
            return (
              <span
                key={b.key}
                className={`trends__day ${b.highlight ? 'trends__day--today' : ''}`}
              >
                {show ? (range === 30 && !b.highlight ? shortDate(b.key) : b.label) : ''}
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
          <div className="trends__stat-value">{avgProtein} g</div>
        </div>
        <div className="trends__stat glass-island">
          <div className="trends__stat-label">Days logged</div>
          <div className="trends__stat-value">
            {summary.loggedDays}
            <span className="trends__stat-of"> / {range}</span>
          </div>
        </div>
      </div>

      <div className="trends__stats">
        <HitTile
          label="Protein goal hit"
          rate={proteinRate}
          unset="Set a protein goal in Settings"
        />
        <HitTile
          label="At or under kcal goal"
          rate={calRate}
          unset="Set a calorie goal in Settings"
        />
      </div>

      {(standouts.mostProtein || standouts.biggest) && (
        <div className="trends__standouts glass-island">
          <div className="trends__section-title">Standout days</div>
          <StandoutRow
            label="Closest to goal"
            day={standouts.closest}
            value={`${Math.round(standouts.closest?.totals.calories ?? 0).toLocaleString()} kcal`}
          />
          <StandoutRow
            label="Most protein"
            day={standouts.mostProtein}
            value={`${Math.round(standouts.mostProtein?.totals.protein ?? 0)} g`}
          />
          <StandoutRow
            label="Biggest day"
            day={standouts.biggest}
            value={`${Math.round(standouts.biggest?.totals.calories ?? 0).toLocaleString()} kcal`}
          />
        </div>
      )}

      {weeks.length > 0 && (
        <div className="trends__weeks glass-island">
          <div className="trends__section-title">Week by week</div>
          {[...weeks].reverse().map((w) => (
            <div key={w.weekStart} className="trends__week">
              <span className="trends__week-label">
                {w.weekStart === weeks[weeks.length - 1].weekStart
                  ? 'This week'
                  : `Week of ${shortDate(w.weekStart)}`}
              </span>
              {w.avg ? (
                <span className="trends__week-values">
                  {Math.round(w.avg.calories).toLocaleString()} kcal · {Math.round(w.avg.protein)} g
                  protein
                </span>
              ) : (
                <span className="trends__week-values trends__week-values--empty">
                  Nothing logged
                </span>
              )}
              <span className="trends__week-days">{w.loggedDays}/7</span>
            </div>
          ))}
        </div>
      )}

      <p className="trends__footer">
        Daily totals are best-guess estimates from an open food database — read them as a weekly
        shape, not a lab report. Averages skip days with nothing logged.
      </p>
    </div>
  )
}
