import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { getSession, signOut } from '../data/auth'
import { getProfile, updateProfile } from '../data/tracker'
import type { ProfileGoals } from '../../shared/types'
import {
  ACTIVITY_OPTIONS,
  DIRECTION_OPTIONS,
  SEX_OPTIONS,
  calculateGoalsSimple
} from '../../shared/goal-calculator'
import type { BodySex, CalculatedGoals, GoalDirection } from '../../shared/goal-calculator'
import { getBodyStats, saveBodyStats } from '../data/bodyStats'
import { useToast } from '../components/Toast'
import { useEnergy } from '../components/EnergyUnit'
import { energyValue, toKcal } from '../../shared/energy'
import type { EnergyUnit } from '../../shared/energy'

const toNum = (s: string): number | null => {
  const n = Number(s)
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}
const toStr = (n: number | null): string => (n == null ? '' : String(Math.round(n)))

export function SettingsPage(): JSX.Element {
  const toast = useToast()
  const energy = useEnergy()
  const [email, setEmail] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [loaded, setLoaded] = useState(false)

  // Daily goals as input strings (blank = no goal → null in the profile).
  // The energy goal as typed, remembering WHICH unit it was typed in: the kJ/kcal
  // preference loads asynchronously and can be flipped on this page, so the field is
  // converted when shown and when saved rather than trusting it matches the current unit.
  const [gCal, setGCalState] = useState<{ text: string; unit: EnergyUnit }>({
    text: '',
    unit: 'kcal'
  })
  const setGCal = (text: string): void => setGCalState({ text, unit: energy.unit })
  const calText =
    gCal.unit === energy.unit || toNum(gCal.text) == null
      ? gCal.text
      : String(energyValue(toKcal(Number(gCal.text), gCal.unit), energy.unit))
  const [gProtein, setGProtein] = useState('')
  const [gCarbs, setGCarbs] = useState('')
  const [gFat, setGFat] = useState('')
  const [gFibre, setGFibre] = useState('')

  // Goal calculator — answers come back from the profile, so it is fill-once.
  const [sex, setSex] = useState<BodySex | ''>('')
  const [age, setAge] = useState('')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [activity, setActivity] = useState(1.55)
  const [direction, setDirection] = useState<GoalDirection>('maintain')
  const [suggestion, setSuggestion] = useState<CalculatedGoals | null>(null)
  const [attempted, setAttempted] = useState(false)

  useEffect(() => {
    getSession().then((s) => setEmail(s?.user.email ?? null))
    getProfile().then((p) => {
      setName(p.name)
      setGCalState({ text: toStr(p.calGoal), unit: 'kcal' }) // stored in kcal
      setGProtein(toStr(p.proteinGoal))
      setGCarbs(toStr(p.carbsGoal))
      setGFat(toStr(p.fatGoal))
      setGFibre(toStr(p.fibreGoal))
      setLoaded(true)
    })
    getBodyStats().then(
      (b) => {
        setSex(b.sex ?? '')
        setAge(toStr(b.age))
        setHeight(toStr(b.heightCm))
        setWeight(b.weightKg == null ? '' : String(b.weightKg))
        setActivity(b.activity)
        setDirection(b.direction)
      },
      () => undefined // not migrated yet / offline — the form just starts empty
    )
  }, [])

  /** Flip kJ⇄kcal everywhere; the goal field on screen re-renders in the new unit. */
  const switchUnit = (next: EnergyUnit): void => {
    if (next === energy.unit) return
    energy.setUnit(next)
  }

  const saveName = async (): Promise<void> => {
    if (!loaded || !name.trim()) return
    await updateProfile({ name: name.trim() })
  }

  const goalsFromInputs = (): ProfileGoals => ({
    // Typed in the display unit, stored in kcal.
    calGoal: toNum(gCal.text) == null ? null : Math.round(toKcal(Number(gCal.text), gCal.unit)),
    proteinGoal: toNum(gProtein),
    carbsGoal: toNum(gCarbs),
    fatGoal: toNum(gFat),
    fibreGoal: toNum(gFibre)
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
    setGFibre('')
    await updateProfile({
      goals: { calGoal: null, proteinGoal: null, carbsGoal: null, fatGoal: null, fibreGoal: null }
    })
    toast('Goals cleared — tracker shows energy share instead')
  }

  const suggest = (): void => {
    setAttempted(true)
    const result =
      sex === ''
        ? null
        : calculateGoalsSimple({
            sex,
            age: Number(age) || 0,
            heightCm: Number(height) || 0,
            weightKg: Number(weight) || 0,
            activity,
            direction
          })
    setSuggestion(result)
    if (result)
      void saveBodyStats({
        sex: sex === '' ? null : sex,
        age: toNum(age),
        heightCm: toNum(height),
        weightKg: toNum(weight),
        activity,
        direction
      }).catch(() => undefined)
  }

  const useSuggestion = async (): Promise<void> => {
    if (!suggestion) return
    setGCalState({ text: String(suggestion.calories), unit: 'kcal' })
    setGProtein(String(suggestion.protein))
    setGCarbs(String(suggestion.carbs))
    setGFat(String(suggestion.fat))
    setGFibre(String(suggestion.fibre))
    await updateProfile({
      goals: {
        calGoal: suggestion.calories,
        proteinGoal: suggestion.protein,
        carbsGoal: suggestion.carbs,
        fatGoal: suggestion.fat,
        fibreGoal: suggestion.fibre
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
          <span className="settings-row__label">Energy</span>
          <div className="seg settings-unit" role="group" aria-label="Energy unit">
            {(['kcal', 'kj'] as EnergyUnit[]).map((u) => (
              <button
                key={u}
                className={`seg__btn seg__btn--small ${energy.unit === u ? 'seg__btn--active' : ''}`}
                aria-pressed={energy.unit === u}
                onClick={() => switchUnit(u)}
              >
                {u === 'kcal' ? 'kcal' : 'kJ'}
              </button>
            ))}
          </div>
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
            <span className="ffield__label">Energy ({energy.label})</span>
            <input
              className="input-field"
              type="number"
              min="0"
              value={calText}
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
          <label className="ffield">
            <span className="ffield__label">Fibre (g)</span>
            <input
              className="input-field"
              type="number"
              min="0"
              value={gFibre}
              onChange={(e) => setGFibre(e.target.value)}
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
            <span className="ffield__label">Sex</span>
            <select
              className="input-field"
              value={sex}
              onChange={(e) => setSex(e.target.value as BodySex | '')}
            >
              <option value="" disabled>
                Choose…
              </option>
              {SEX_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
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
            <span className="ffield__label">Height (cm)</span>
            <input
              className="input-field"
              type="number"
              min="0"
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
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
              {energy.fmt(suggestion.calories)} · P {suggestion.protein} · C {suggestion.carbs} · F{' '}
              {suggestion.fat} · Fibre {suggestion.fibre}
            </div>
            <button className="btn-primary settings-result__use" onClick={useSuggestion}>
              Use these
            </button>
          </div>
        )}
        {attempted && suggestion === null && (
          <p className="settings-calc-note">
            Choose sex and enter a plausible age, height and weight, then tap Suggest goals.
          </p>
        )}
      </section>
    </div>
  )
}
