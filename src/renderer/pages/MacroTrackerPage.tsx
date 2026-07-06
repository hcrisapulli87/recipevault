import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DailyLog, LogEntry, MealType } from '../../shared/types'
import { MEAL_LABEL, MEAL_TYPES } from '../../shared/types'
import { AddFoodModal } from '../components/AddFoodModal'
import { ProfileModal } from '../components/ProfileModal'
import { macroCalorieShares } from '../../shared/tracker-logic'
import { deleteLogEntry, getDailyLog, getProfile, updateLogEntry } from '../data/tracker'
import type { TrackerProfile } from '../data/tracker'
import { onTableChange } from '../data/realtime'
import { PersonSwitcher } from '../components/PersonSwitcher'
import { useHousehold } from '../hooks/useHousehold'
import type { HouseholdUser } from '../data/users'

const round1 = (n: number): number => Math.round(n * 10) / 10

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
function prettyDate(date: string): string {
  if (date === todayStr()) return 'Today'
  if (date === shiftDate(todayStr(), -1)) return 'Yesterday'
  return new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
}

function amountLabel(e: LogEntry): string {
  if (e.unit === '100g') return `${Math.round(e.amount * 100)} g`
  const n = round1(e.amount)
  return `${n} serving${n === 1 ? '' : 's'}`
}

function MacroBar(props: {
  label: string
  value: number
  goal: number | null
  sharePct: number
  unit: string
  color: string
}): JSX.Element {
  // With a goal the bar tracks progress toward it; without one it falls back to
  // this macro's share of the day's calories, so it still fills as food is logged.
  const pct = props.goal ? Math.min(100, (props.value / props.goal) * 100) : props.sharePct
  return (
    <div className="macro-bar">
      <div className="macro-bar__head">
        <span className="macro-bar__label">{props.label}</span>
        <span className="macro-bar__value">
          {Math.round(props.value)}
          {props.unit}
          {props.goal != null
            ? ` / ${Math.round(props.goal)}${props.unit}`
            : props.sharePct > 0
              ? ` · ${Math.round(props.sharePct)}% of kcal`
              : ''}
        </span>
      </div>
      <div className="macro-bar__track">
        <div className="macro-bar__fill" style={{ width: `${pct}%`, background: props.color }} />
      </div>
    </div>
  )
}

function EntryRow(props: {
  entry: LogEntry
  readOnly: boolean
  onChangeAmount: (amount: number) => void
  onDelete: () => void
}): JSX.Element {
  const { entry } = props
  const [editing, setEditing] = useState(false)
  const isGram = entry.unit === '100g'
  const [value, setValue] = useState(isGram ? entry.amount * 100 : entry.amount)

  const save = (): void => {
    const amount = isGram ? value / 100 : value
    if (amount > 0) props.onChangeAmount(amount)
    setEditing(false)
  }

  const cals = Math.round(entry.baseCalories * entry.amount)
  return (
    <div className="food-entry">
      <div className="food-entry__main">
        <span className="food-entry__name">
          {entry.name}
          {entry.brand ? <span className="food-entry__brand"> · {entry.brand}</span> : null}
        </span>
        {editing ? (
          <span className="food-entry__edit">
            <input
              className="text-input food-entry__amount-input"
              type="number"
              min="0"
              step={isGram ? 10 : 0.5}
              value={value}
              autoFocus
              onChange={(e) => setValue(Math.max(0, Number(e.target.value)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
            <span className="food-entry__unit">{isGram ? 'g' : 'srv'}</span>
            <button className="icon-btn" title="Save" onClick={save}>
              ✓
            </button>
          </span>
        ) : (
          <span className="food-entry__sub">{amountLabel(entry)}</span>
        )}
      </div>
      <span className="food-entry__macros">
        <span className="food-entry__cals">{cals} kcal</span>
        <span className="food-entry__pcf">
          P {round1(entry.baseProtein * entry.amount)} · C {round1(entry.baseCarbs * entry.amount)}{' '}
          · F {round1(entry.baseFat * entry.amount)}
        </span>
      </span>
      {!props.readOnly && (
        <div className="food-entry__btns">
          <button className="icon-btn" title="Edit amount" onClick={() => setEditing(true)}>
            ✏️
          </button>
          <button className="icon-btn" title="Remove" onClick={props.onDelete}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

export function MacroTrackerPage(): JSX.Element {
  const [profile, setProfile] = useState<TrackerProfile | null>(null)
  const [date, setDate] = useState(todayStr())
  const [log, setLog] = useState<DailyLog | null>(null)
  const [adding, setAdding] = useState<MealType | null>(null)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const users = useHousehold()
  const [viewer, setViewer] = useState<HouseholdUser | null>(null)
  const current = viewer ?? users[0] ?? null
  const readOnly = current !== null && !current.isMe

  // Flipping days or Me/partner fires overlapping fetches; only the response for
  // the view still on screen may land, otherwise the last *response* wins.
  const viewRef = useRef('')
  useEffect(() => {
    viewRef.current = `${date}|${current?.id ?? ''}`
  })

  const loadProfile = useCallback((): void => {
    getProfile().then(setProfile)
  }, [])

  useEffect(() => {
    loadProfile()
    return onTableChange(['profiles'], loadProfile)
  }, [loadProfile])

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

  const changeAmount = async (id: number, amount: number): Promise<void> => {
    await updateLogEntry(id, amount)
    reloadLog()
  }
  const deleteEntry = async (id: number): Promise<void> => {
    await deleteLogEntry(id)
    reloadLog()
  }

  const totals = log?.totals ?? { calories: 0, protein: 0, carbs: 0, fat: 0 }
  const goals = log?.goals ?? { calories: null, protein: null, carbs: null, fat: null }
  const shares = macroCalorieShares(totals)
  const noGoals =
    goals.calories == null && goals.protein == null && goals.carbs == null && goals.fat == null

  return (
    <div>
      <div className="page-header">
        <h2 className="page-header__title">Tracker</h2>
        <div className="tracker-controls">
          <PersonSwitcher
            users={users}
            selectedId={current?.id ?? ''}
            onSelect={(u) => setViewer(u)}
          />
          {!readOnly && profile && <span className="tracker-profile-name">{profile.name}</span>}
          {!readOnly && (
            <button
              className="btn"
              onClick={() => setProfileModalOpen(true)}
              disabled={!profile}
              title="Edit goals"
            >
              ⚙️ Goals
            </button>
          )}
        </div>
      </div>

      {readOnly && current && (
        <p className="empty-note">Viewing {current.name}’s tracker — read only.</p>
      )}

      <div className="date-nav">
        <button
          className="icon-btn"
          onClick={() => setDate(shiftDate(date, -1))}
          title="Previous day"
        >
          ◀
        </button>
        <span className="date-nav__label">{prettyDate(date)}</span>
        <button
          className="icon-btn"
          onClick={() => setDate(shiftDate(date, 1))}
          title="Next day"
          disabled={date >= todayStr()}
        >
          ▶
        </button>
        {date !== todayStr() && (
          <button className="link-btn" onClick={() => setDate(todayStr())}>
            Jump to today
          </button>
        )}
      </div>

      <div className="hero-card">
        <div
          className="cal-ring"
          style={{
            background: `conic-gradient(var(--accent) ${
              goals.calories ? Math.min(100, (totals.calories / goals.calories) * 100) : 0
            }%, var(--bg-elevated) 0)`
          }}
        >
          <div className="cal-ring__inner">
            <span
              className={`cal-ring__value ${
                goals.calories != null && totals.calories > goals.calories
                  ? 'cal-ring__value--over'
                  : ''
              }`}
            >
              {Math.round(totals.calories).toLocaleString()}
            </span>
            <span className="cal-ring__label">
              {goals.calories != null
                ? `of ${Math.round(goals.calories).toLocaleString()} kcal`
                : 'kcal'}
            </span>
          </div>
        </div>
        <div className="hero-card__bars">
          <MacroBar
            label="Protein"
            value={totals.protein}
            goal={goals.protein}
            sharePct={shares.protein}
            unit="g"
            color="var(--blue)"
          />
          <MacroBar
            label="Carbs"
            value={totals.carbs}
            goal={goals.carbs}
            sharePct={shares.carbs}
            unit="g"
            color="var(--green)"
          />
          <MacroBar
            label="Fat"
            value={totals.fat}
            goal={goals.fat}
            sharePct={shares.fat}
            unit="g"
            color="var(--amber)"
          />
          {noGoals && (
            <p className="hero-card__hint">
              No goals set — bars show today’s macro split.
              {!readOnly && ' Set or calculate goals via ⚙️ Goals.'}
            </p>
          )}
        </div>
      </div>

      <div className="meal-grid">
        {MEAL_TYPES.map((meal) => {
          const entries = log?.meals[meal] ?? []
          return (
            <section key={meal} className="meal-section">
              <div className="meal-section__head">
                <h3 className="meal-section__title">{MEAL_LABEL[meal]}</h3>
                {!readOnly && (
                  <button className="link-btn" onClick={() => setAdding(meal)}>
                    ➕ Add food
                  </button>
                )}
              </div>
              {entries.length === 0 ? (
                <p className="meal-section__empty">Nothing logged yet.</p>
              ) : (
                <div className="meal-section__entries">
                  {entries.map((e) => (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      readOnly={readOnly}
                      onChangeAmount={(amount) => changeAmount(e.id, amount)}
                      onDelete={() => deleteEntry(e.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>

      <p className="tracker-note">
        Macros are best-guess estimates from a built-in food list and OpenFoodFacts — tweak the
        amount on anything that looks off.
      </p>

      {adding && (
        <AddFoodModal
          mealType={adding}
          date={date}
          onClose={() => setAdding(null)}
          onLogged={reloadLog}
        />
      )}

      {profileModalOpen && profile && (
        <ProfileModal
          profile={profile}
          onClose={() => setProfileModalOpen(false)}
          onSaved={() => {
            loadProfile()
            reloadLog()
          }}
        />
      )}
    </div>
  )
}
