import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { DailyLog, LogEntry, MealType, Profile } from '../../shared/types'
import { MEAL_LABEL, MEAL_TYPES } from '../../shared/types'
import { AddFoodModal } from '../components/AddFoodModal'
import { ProfileModal } from '../components/ProfileModal'

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
  unit: string
  color: string
}): JSX.Element {
  const pct = props.goal ? Math.min(100, (props.value / props.goal) * 100) : 0
  return (
    <div className="macro-bar">
      <div className="macro-bar__head">
        <span className="macro-bar__label">{props.label}</span>
        <span className="macro-bar__value">
          {Math.round(props.value)}
          {props.unit}
          {props.goal != null ? ` / ${Math.round(props.goal)}${props.unit}` : ''}
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
      <div className="food-entry__btns">
        <button className="icon-btn" title="Edit amount" onClick={() => setEditing(true)}>
          ✏️
        </button>
        <button className="icon-btn" title="Remove" onClick={props.onDelete}>
          ✕
        </button>
      </div>
    </div>
  )
}

export function MacroTrackerPage(): JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [date, setDate] = useState(todayStr())
  const [log, setLog] = useState<DailyLog | null>(null)
  const [adding, setAdding] = useState<MealType | null>(null)
  const [profileModalOpen, setProfileModalOpen] = useState(false)

  const loadProfiles = useCallback((): Promise<void> => {
    return Promise.all([window.api.getProfiles(), window.api.getSettings()]).then(
      ([profs, settings]) => {
        setProfiles(profs)
        setActiveId((cur) => {
          if (cur != null && profs.some((p) => p.id === cur)) return cur
          const fromSettings = profs.find((p) => p.id === settings.activeProfileId)
          return (fromSettings ?? profs[0])?.id ?? null
        })
      }
    )
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  const reloadLog = useCallback((): void => {
    if (activeId == null) return
    window.api.getDailyLog({ profileId: activeId, date }).then(setLog)
  }, [activeId, date])

  useEffect(() => {
    reloadLog()
  }, [reloadLog])

  const switchProfile = async (id: number): Promise<void> => {
    setActiveId(id)
    const s = await window.api.getSettings()
    await window.api.setSettings({
      botFolder: s.botFolder,
      groceriesList: s.groceriesList,
      activeProfileId: id
    })
  }

  const handleAddProfile = async (): Promise<void> => {
    const name = window.prompt('New profile name?')?.trim()
    if (!name) return
    const id = await window.api.addProfile(name)
    await loadProfiles()
    switchProfile(id)
  }

  const changeAmount = async (id: number, amount: number): Promise<void> => {
    await window.api.updateLogEntry({ id, amount })
    reloadLog()
  }
  const deleteEntry = async (id: number): Promise<void> => {
    await window.api.deleteLogEntry(id)
    reloadLog()
  }

  const profile = profiles.find((p) => p.id === activeId) ?? null
  const totals = log?.totals ?? { calories: 0, protein: 0, carbs: 0, fat: 0 }
  const goals = log?.goals ?? { calories: null, protein: null, carbs: null, fat: null }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-header__title">Tracker</h2>
        <div className="tracker-controls">
          <select
            className="text-input tracker-profile"
            value={activeId ?? ''}
            onChange={(e) => switchProfile(Number(e.target.value))}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={handleAddProfile} title="New profile">
            ＋
          </button>
          <button
            className="btn"
            onClick={() => setProfileModalOpen(true)}
            disabled={!profile}
            title="Edit goals"
          >
            ⚙️ Goals
          </button>
        </div>
      </div>

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

      <div className="totals-card">
        <div className="totals-card__cals">
          <span className="totals-card__cals-value">{Math.round(totals.calories)}</span>
          <span className="totals-card__cals-label">
            kcal{goals.calories != null ? ` of ${Math.round(goals.calories)}` : ''}
          </span>
        </div>
        <div className="totals-card__bars">
          <MacroBar
            label="Protein"
            value={totals.protein}
            goal={goals.protein}
            unit="g"
            color="var(--green)"
          />
          <MacroBar
            label="Carbs"
            value={totals.carbs}
            goal={goals.carbs}
            unit="g"
            color="var(--amber)"
          />
          <MacroBar
            label="Fat"
            value={totals.fat}
            goal={goals.fat}
            unit="g"
            color="var(--accent-bright)"
          />
        </div>
      </div>

      {MEAL_TYPES.map((meal) => {
        const entries = log?.meals[meal] ?? []
        return (
          <section key={meal} className="meal-section">
            <div className="meal-section__head">
              <h3 className="meal-section__title">{MEAL_LABEL[meal]}</h3>
              <button className="link-btn" onClick={() => setAdding(meal)}>
                ➕ Add food
              </button>
            </div>
            {entries.length === 0 ? (
              <p className="meal-section__empty">Nothing logged yet.</p>
            ) : (
              <div className="meal-section__entries">
                {entries.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    onChangeAmount={(amount) => changeAmount(e.id, amount)}
                    onDelete={() => deleteEntry(e.id)}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}

      <p className="tracker-note">
        Macros are best-guess estimates from a built-in food list and OpenFoodFacts — tweak the
        amount on anything that looks off.
      </p>

      {adding && activeId != null && (
        <AddFoodModal
          mealType={adding}
          profileId={activeId}
          date={date}
          onClose={() => setAdding(null)}
          onLogged={reloadLog}
        />
      )}

      {profileModalOpen && profile && (
        <ProfileModal
          profile={profile}
          canDelete={profiles.length > 1}
          onClose={() => setProfileModalOpen(false)}
          onSaved={() => {
            loadProfiles()
            reloadLog()
          }}
          onDeleted={() => {
            setActiveId(null)
            loadProfiles()
          }}
        />
      )}
    </div>
  )
}
