import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ChevronLeft, ChevronRight, Flame, Plus } from 'lucide-react'
import type {
  DailyLog,
  DailyTotals,
  FoodItem,
  LogEntry,
  MealPlanEntry,
  MealType,
  RecipeSummary
} from '../../shared/types'
import { DAYS, MEAL_LABEL, MEAL_TYPES } from '../../shared/types'
import { macroCalorieShares } from '../../shared/tracker-logic'
import { planSlotToFood } from '../../shared/plan-to-food'
import { deleteLogEntry, getDailyLog, getDailyTotalsRange, updateLogEntry } from '../data/tracker'
import { getMealPlan } from '../data/mealPlan'
import { loggingStreak, shiftDate as shiftIso } from '../../shared/trends'
import { onTableChange } from '../data/realtime'
import { PersonSwitcher } from '../components/PersonSwitcher'
import type { HouseholdUser } from '../data/users'

const round1 = (n: number): number => Math.round(n * 10) / 10
/** "142" or "6.4" — whole numbers stay whole (prototype's fmtG). */
const fmtG = (n: number): string => {
  const v = round1(n)
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1)
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}
const todayStr = (): string => isoDate(new Date())
function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return isoDate(d)
}
/** "Today, 18 Jul" / "Yesterday, 17 Jul" / "Tue, 15 Jul" */
function dateLabel(date: string): string {
  const d = new Date(date + 'T00:00:00')
  const dayMonth = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const kicker =
    date === todayStr()
      ? 'Today'
      : date === shiftDate(todayStr(), -1)
        ? 'Yesterday'
        : d.toLocaleDateString(undefined, { weekday: 'short' })
  return `${kicker}, ${dayMonth}`
}

function portionText(e: LogEntry): string {
  if (e.unit === '100g') return `${Math.round(e.amount * 100)} g`
  const n = round1(e.amount)
  return `${n % 1 === 0 ? Math.round(n) : n} serving${n === 1 ? '' : 's'}`
}

/** One food row: tap to expand the in-place − / + stepper strip (own log, today only). */
function EntryRow(props: {
  entry: LogEntry
  canEdit: boolean
  editing: boolean
  onToggleEdit: () => void
  onChangeAmount: (amount: number) => void
  onDelete: () => void
}): JSX.Element {
  const { entry } = props
  const isGram = entry.unit === '100g'
  const step = isGram ? 0.1 : 0.5 // 10 g in gram mode, half-serve otherwise
  const cals = Math.round(entry.baseCalories * entry.amount)
  const sub = [
    entry.brand,
    portionText(entry),
    `P ${fmtG(entry.baseProtein * entry.amount)} · C ${fmtG(entry.baseCarbs * entry.amount)} · F ${fmtG(entry.baseFat * entry.amount)}`
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="tracker-entry">
      <div
        className="tracker-entry__row"
        role={props.canEdit ? 'button' : undefined}
        onClick={() => {
          if (props.canEdit) props.onToggleEdit()
        }}
      >
        <div className="tracker-entry__main">
          <div className="tracker-entry__name">{entry.name}</div>
          <div className="tracker-entry__sub">{sub}</div>
        </div>
        <span className="tracker-entry__kcal">{cals}</span>
      </div>
      {props.editing && (
        <div className="tracker-entry__edit">
          <button
            className="round-btn tracker-entry__step"
            aria-label="Less"
            onClick={() => props.onChangeAmount(Math.max(step, round1(entry.amount - step)))}
          >
            −
          </button>
          <span className="tracker-entry__portion">{portionText(entry)}</span>
          <button
            className="round-btn tracker-entry__step"
            aria-label="More"
            onClick={() => props.onChangeAmount(round1(entry.amount + step))}
          >
            +
          </button>
          <span className="tracker-entry__spacer" />
          <button className="tracker-entry__delete" onClick={props.onDelete}>
            Delete
          </button>
          <button className="tracker-entry__done" onClick={props.onToggleEdit}>
            Done
          </button>
        </div>
      )}
    </div>
  )
}

/** Protein / Carbs / Fat tile inside the hero island. */
function MacroTile(props: {
  label: string
  value: number
  goal: number | null
  sharePct: number
  color: string
}): JSX.Element {
  const over = props.goal != null && props.value > props.goal
  const pct =
    props.goal != null
      ? Math.min(100, Math.round((props.value / props.goal) * 100))
      : Math.round(props.sharePct)
  const valueText =
    props.goal != null
      ? `${fmtG(props.value)} / ${Math.round(props.goal)} g`
      : `${fmtG(props.value)} g · ${Math.round(props.sharePct)}%`
  return (
    <div className="macro-tile glass-tile">
      <div className="macro-tile__label">{props.label}</div>
      <div className="macro-tile__value" style={over ? { color: 'var(--over-text)' } : undefined}>
        {valueText}
      </div>
      <div className="macro-tile__track">
        <div
          className="macro-tile__fill"
          style={{ width: `${pct}%`, background: over ? 'var(--over-bar)' : props.color }}
        />
      </div>
    </div>
  )
}

export function MacroTrackerPage(props: {
  recipes: RecipeSummary[]
  users: HouseholdUser[]
  current: HouseholdUser | null
  readOnly: boolean
  onSelectViewer: (user: HouseholdUser) => void
  onAddFood: (meal: MealType, planned: FoodItem | null) => void
}): JSX.Element {
  const [date, setDate] = useState(todayStr())
  const [log, setLog] = useState<DailyLog | null>(null)
  const [rangeTotals, setRangeTotals] = useState<Map<string, DailyTotals> | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const { users, current, readOnly } = props

  const isToday = date === todayStr()
  const canEdit = !readOnly && isToday
  const minDate = shiftDate(todayStr(), -6) // spec: step back up to 6 days

  // Flipping days or H/K fires overlapping fetches; only the response for the
  // view still on screen may land, otherwise the last *response* wins.
  const viewRef = useRef('')
  useEffect(() => {
    viewRef.current = `${date}|${current?.id ?? ''}`
  })

  const reloadLog = useCallback((): void => {
    if (!current) return
    const view = `${date}|${current.id}`
    getDailyLog(date, { id: current.id, isMe: current.isMe }).then((l) => {
      if (view === viewRef.current) setLog(l)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, current?.id])

  useEffect(() => {
    reloadLog()
    return onTableChange(['food_log'], reloadLog)
  }, [reloadLog])

  // Recent totals for the streak chip (consecutive days with ≥1 entry).
  const reloadRange = useCallback((): void => {
    if (!current) return
    const forId = current.id
    getDailyTotalsRange(forId, shiftIso(todayStr(), -29), todayStr()).then((m) => {
      if (viewRef.current.endsWith(`|${forId}`)) setRangeTotals(m)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id])

  useEffect(() => {
    reloadRange()
    return onTableChange(['food_log'], reloadRange)
  }, [reloadRange])

  // The shared household meal plan, for the one-tap "log the planned meal" card.
  const [plan, setPlan] = useState<MealPlanEntry[] | null>(null)
  const reloadPlan = useCallback((): void => {
    getMealPlan().then(setPlan)
  }, [])

  useEffect(() => {
    reloadPlan()
    return onTableChange(['meal_plan'], reloadPlan)
  }, [reloadPlan])

  /** The recipe planned for this meal today, as a ready-to-log item. The mapping is
   *  shared with the planner's own "Log to tracker" action so a leftover night logs
   *  exactly what the cook night did. */
  const plannedFor = (meal: MealType): FoodItem | null => {
    if (meal === 'snack' || !plan) return null
    const jsDay = new Date(date + 'T00:00:00').getDay()
    const day = DAYS[(jsDay + 6) % 7] // getDay(): 0=Sunday; our week starts Monday
    const slot = plan.find((e) => e.day === day && e.meal === meal)
    return slot ? planSlotToFood(slot, props.recipes) : null
  }

  const changeAmount = async (id: number, amount: number): Promise<void> => {
    await updateLogEntry(id, amount)
    reloadLog()
  }
  const deleteEntry = async (id: number): Promise<void> => {
    await deleteLogEntry(id)
    setEditingId(null)
    reloadLog()
  }

  const totals = log?.totals ?? { calories: 0, protein: 0, carbs: 0, fat: 0 }
  const goals = log?.goals ?? { calories: null, protein: null, carbs: null, fat: null }
  const shares = macroCalorieShares(totals)
  const calGoal = goals.calories
  const streak = rangeTotals ? loggingStreak(rangeTotals, todayStr()) : 0
  const dayEmpty =
    log != null && MEAL_TYPES.every((m) => (log.meals[m] ?? []).length === 0) && !readOnly

  const heroSub = dayEmpty
    ? 'Nothing logged yet'
    : calGoal == null
      ? 'No goal set — showing energy share per macro'
      : calGoal - totals.calories >= 0
        ? `${Math.round(calGoal - totals.calories).toLocaleString()} left`
        : `${Math.round(totals.calories - calGoal).toLocaleString()} over — tomorrow is a new day`

  return (
    <div className="tracker">
      {/* Header: date pill · streak chip · H/K switcher */}
      <div className="tracker__top">
        <div className="date-pill glass-pill">
          <button
            className="date-pill__btn"
            aria-label="Previous day"
            disabled={date <= minDate}
            onClick={() => {
              setEditingId(null)
              setDate(shiftDate(date, -1))
            }}
          >
            <ChevronLeft size={14} strokeWidth={2.4} />
          </button>
          <span className="date-pill__label">{dateLabel(date)}</span>
          <button
            className="date-pill__btn date-pill__btn--next"
            aria-label="Next day"
            disabled={isToday}
            onClick={() => {
              setEditingId(null)
              setDate(shiftDate(date, 1))
            }}
          >
            <ChevronRight size={14} strokeWidth={2.4} />
          </button>
        </div>
        <div className="tracker__top-right">
          {streak > 1 && (
            <span className="streak-chip glass-pill">
              <Flame size={12} strokeWidth={2.2} />
              {streak}
            </span>
          )}
          <PersonSwitcher
            users={users}
            selectedId={current?.id ?? ''}
            onSelect={(u) => {
              setEditingId(null)
              props.onSelectViewer(u)
            }}
          />
        </div>
      </div>

      {readOnly && current && (
        <div className="partner-banner">{current.name}&rsquo;s log — read-only</div>
      )}

      {/* Hero island */}
      <div className="tracker-hero glass-hero">
        <div className="tracker-hero__eyebrow">Eaten · estimates</div>
        <div className="tracker-hero__kcal-row">
          <span className="tracker-hero__kcal">{Math.round(totals.calories).toLocaleString()}</span>
          <span className="tracker-hero__goal">
            {calGoal != null ? `/ ${Math.round(calGoal).toLocaleString()} kcal` : 'kcal eaten'}
          </span>
        </div>
        {calGoal != null && (
          <div className="tracker-hero__track">
            <div
              className="tracker-hero__fill"
              style={{ width: `${Math.min(100, Math.round((totals.calories / calGoal) * 100))}%` }}
            />
          </div>
        )}
        <div className="tracker-hero__sub">{heroSub}</div>
        <div className="tracker-hero__tiles">
          <MacroTile
            label="Protein"
            value={totals.protein}
            goal={goals.protein}
            sharePct={shares.protein}
            color="var(--protein)"
          />
          <MacroTile
            label="Carbs"
            value={totals.carbs}
            goal={goals.carbs}
            sharePct={shares.carbs}
            color="var(--carbs)"
          />
          <MacroTile
            label="Fat"
            value={totals.fat}
            goal={goals.fat}
            sharePct={shares.fat}
            color="var(--fat)"
          />
        </div>
      </div>

      {/* Empty-day nudge (own log only) */}
      {dayEmpty && isToday && (
        <div className="tracker-empty glass-island">
          <div className="tracker-empty__title">Nothing logged yet</div>
          <p className="tracker-empty__copy">
            {streak > 1
              ? `Log the first food of the day to keep the ${streak}-day streak going.`
              : 'Log the first food of the day — close enough is the point.'}
          </p>
          <button className="btn-primary" onClick={() => props.onAddFood('breakfast', null)}>
            + Log a food
          </button>
        </div>
      )}

      {/* Meal cards — always all four */}
      <div className="tracker-meals">
        {MEAL_TYPES.map((meal) => {
          const entries = log?.meals[meal] ?? []
          const mealKcal = Math.round(entries.reduce((a, e) => a + e.baseCalories * e.amount, 0))
          return (
            <section key={meal} className="meal-card glass-island">
              <div className="meal-card__head">
                <span className="meal-card__title">
                  {MEAL_LABEL[meal]} <span className="meal-card__kcal">· {mealKcal} kcal</span>
                </span>
                {canEdit && (
                  <button
                    className="meal-card__add"
                    aria-label={`Add to ${MEAL_LABEL[meal]}`}
                    onClick={() => props.onAddFood(meal, plannedFor(meal))}
                  >
                    <Plus size={15} strokeWidth={2.6} />
                  </button>
                )}
              </div>
              {entries.length === 0 ? (
                <div className="meal-card__empty">Nothing yet</div>
              ) : (
                entries.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    canEdit={canEdit}
                    editing={editingId === e.id}
                    onToggleEdit={() => setEditingId(editingId === e.id ? null : e.id)}
                    onChangeAmount={(amount) => changeAmount(e.id, amount)}
                    onDelete={() => deleteEntry(e.id)}
                  />
                ))
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
