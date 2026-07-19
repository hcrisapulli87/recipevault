import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { getSession, signOut } from '../data/auth'
import { getProfile, updateProfile } from '../data/tracker'
import type { ProfileGoals } from '../../shared/types'
import {
  ACTIVITY_OPTIONS,
  DIRECTION_OPTIONS,
  calculateGoalsSimple
} from '../../shared/goal-calculator'
import type { CalculatedGoals, GoalDirection } from '../../shared/goal-calculator'
import { useToast } from '../components/Toast'

const toNum = (s: string): number | null => {
  const n = Number(s)
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}
const toStr = (n: number | null): string => (n == null ? '' : String(Math.round(n)))

export function SettingsPage(): JSX.Element {
  const toast = useToast()
  const [email, setEmail] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Daily goals as input strings (blank = no goal → null in the profile).
  const [gCal, setGCal] = useState('')
  const [gProtein, setGProtein] = useState('')
  const [gCarbs, setGCarbs] = useState('')
  const [gFat, setGFat] = useState('')

  // Goal calculator
  const [age, setAge] = useState('')
  const [weight, setWeight] = useState('')
  const [activity, setActivity] = useState(1.55)
  const [direction, setDirection] = useState<GoalDirection>('maintain')
  const [suggestion, setSuggestion] = useState<CalculatedGoals | null>(null)
  const [attempted, setAttempted] = useState(false)

  useEffect(() => {
    getSession().then((s) => setEmail(s?.user.email ?? null))
    getProfile().then((p) => {
      setName(p.name)
      setGCal(toStr(p.calGoal))
      setGProtein(toStr(p.proteinGoal))
      setGCarbs(toStr(p.carbsGoal))
      setGFat(toStr(p.fatGoal))
      setLoaded(true)
    })
  }, [])

  const saveName = async (): Promise<void> => {
    if (!loaded || !name.trim()) return
    await updateProfile({ name: name.trim() })
  }

  const goalsFromInputs = (): ProfileGoals => ({
    calGoal: toNum(gCal),
    proteinGoal: toNum(gProtein),
    carbsGoal: toNum(gCarbs),
    fatGoal: toNum(gFat)
  })

  const saveGoals = async (): Promise<void> => {
    if (!loaded) return
    await updateProfile({ goals: goalsFromInputs() })
  }

  const clearGoals = async (): Promise<void> => {
    setGCal('')
    setGProtein('')
    setGCarbs('')
    setGFat('')
    await updateProfile({
      goals: { calGoal: null, proteinGoal: null, carbsGoal: null, fatGoal: null }
    })
    toast('Goals cleared — tracker shows energy share instead')
  }

  const suggest = (): void => {
    setAttempted(true)
    setSuggestion(
      calculateGoalsSimple({
        age: Number(age) || 0,
        weightKg: Number(weight) || 0,
        activity,
        direction
      })
    )
  }

  const useSuggestion = async (): Promise<void> => {
    if (!suggestion) return
    setGCal(String(suggestion.calories))
    setGProtein(String(suggestion.protein))
    setGCarbs(String(suggestion.carbs))
    setGFat(String(suggestion.fat))
    await updateProfile({
      goals: {
        calGoal: suggestion.calories,
        proteinGoal: suggestion.protein,
        carbsGoal: suggestion.carbs,
        fatGoal: suggestion.fat
      }
    })
    toast('Goals updated')
  }

  return (
    <div className="settings">
      {/* Account */}
      <section className="settings-island glass-island">
        <div className="settings-row">
          <div className="settings-row__main">
            <input
              className="settings-name"
              value={name}
              placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
            />
            <div className="settings-row__sub">{email ?? 'Loading…'}</div>
          </div>
          <span className="settings-chip">Signed in</span>
        </div>
        <div className="settings-row">
          <span className="settings-row__label">Theme</span>
          <span className="settings-row__value">Glass (light)</span>
        </div>
        <div className="settings-row settings-row--last">
          <button className="btn-ghost btn-ghost--destructive" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </section>

      {/* Daily goals */}
      <section className="settings-island glass-island settings-island--padded">
        <div className="settings-island__title">Daily goals</div>
        <div className="ffield-grid settings-goals">
          <label className="ffield">
            <span className="ffield__label">Calories (kcal)</span>
            <input
              className="input-field"
              type="number"
              min="0"
              value={gCal}
              onChange={(e) => setGCal(e.target.value)}
              onBlur={saveGoals}
            />
          </label>
          <label className="ffield">
            <span className="ffield__label">Protein (g)</span>
            <input
              className="input-field"
              type="number"
              min="0"
              value={gProtein}
              onChange={(e) => setGProtein(e.target.value)}
              onBlur={saveGoals}
            />
          </label>
          <label className="ffield">
            <span className="ffield__label">Carbs (g)</span>
            <input
              className="input-field"
              type="number"
              min="0"
              value={gCarbs}
              onChange={(e) => setGCarbs(e.target.value)}
              onBlur={saveGoals}
            />
          </label>
          <label className="ffield">
            <span className="ffield__label">Fat (g)</span>
            <input
              className="input-field"
              type="number"
              min="0"
              value={gFat}
              onChange={(e) => setGFat(e.target.value)}
              onBlur={saveGoals}
            />
          </label>
        </div>
        <button className="btn-ghost settings-clear" onClick={clearGoals}>
          Clear goals (track without targets)
        </button>
      </section>

      {/* Goal calculator */}
      <section className="settings-island glass-island settings-island--padded">
        <div className="settings-island__title">Goal calculator</div>
        <div className="ffield-grid settings-goals">
          <label className="ffield">
            <span className="ffield__label">Age</span>
            <input
              className="input-field"
              type="number"
              min="0"
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
          </label>
          <label className="ffield">
            <span className="ffield__label">Weight (kg)</span>
            <input
              className="input-field"
              type="number"
              min="0"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
          <label className="ffield">
            <span className="ffield__label">Activity</span>
            <select
              className="input-field"
              value={activity}
              onChange={(e) => setActivity(Number(e.target.value))}
            >
              {ACTIVITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ffield">
            <span className="ffield__label">Goal</span>
            <select
              className="input-field"
              value={direction}
              onChange={(e) => setDirection(e.target.value as GoalDirection)}
            >
              {DIRECTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button className="btn-secondary settings-suggest" onClick={suggest}>
          Suggest goals
        </button>
        {suggestion && (
          <div className="settings-result">
            <div className="settings-result__note">Suggested (rough guide, not medical advice)</div>
            <div className="settings-result__line">
              {suggestion.calories.toLocaleString()} kcal · P {suggestion.protein} · C{' '}
              {suggestion.carbs} · F {suggestion.fat}
            </div>
            <button className="btn-primary settings-result__use" onClick={useSuggestion}>
              Use these
            </button>
          </div>
        )}
        {attempted && suggestion === null && (
          <p className="settings-calc-note">
            Enter a plausible age and weight, then tap Suggest goals.
          </p>
        )}
      </section>
    </div>
  )
}
