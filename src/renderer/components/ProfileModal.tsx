import { useState } from 'react'
import type { JSX } from 'react'
import type { ProfileGoals } from '../../shared/types'
import { ACTIVITY_LABEL, calculateGoals } from '../../shared/goal-calculator'
import type { ActivityLevel, GoalDirection, Sex } from '../../shared/goal-calculator'
import { updateProfile } from '../data/tracker'
import type { TrackerProfile } from '../data/tracker'

const ACTIVITY_LEVELS = Object.keys(ACTIVITY_LABEL) as ActivityLevel[]
const DIRECTION_LABEL: Record<GoalDirection, string> = {
  lose: 'Lose weight',
  maintain: 'Maintain',
  gain: 'Gain weight'
}

const toGoal = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Edit the signed-in user's display name + daily macro goals. */
export function ProfileModal(props: {
  profile: TrackerProfile
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const { profile } = props
  const [name, setName] = useState(profile.name)
  const [cal, setCal] = useState(profile.calGoal?.toString() ?? '')
  const [protein, setProtein] = useState(profile.proteinGoal?.toString() ?? '')
  const [carbs, setCarbs] = useState(profile.carbsGoal?.toString() ?? '')
  const [fat, setFat] = useState(profile.fatGoal?.toString() ?? '')

  // Goal calculator — inputs are transient (only the resulting goals are saved).
  const [calcOpen, setCalcOpen] = useState(false)
  const [sex, setSex] = useState<Sex>('male')
  const [age, setAge] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [activity, setActivity] = useState<ActivityLevel>('moderate')
  const [direction, setDirection] = useState<GoalDirection>('maintain')

  const calculated = calculateGoals({
    sex,
    age: Number(age),
    heightCm: Number(heightCm),
    weightKg: Number(weightKg),
    activity,
    direction
  })

  const applyCalculated = (): void => {
    if (!calculated) return
    setCal(String(calculated.calories))
    setProtein(String(calculated.protein))
    setCarbs(String(calculated.carbs))
    setFat(String(calculated.fat))
  }

  const save = async (): Promise<void> => {
    const goals: ProfileGoals = {
      calGoal: toGoal(cal),
      proteinGoal: toGoal(protein),
      carbsGoal: toGoal(carbs),
      fatGoal: toGoal(fat)
    }
    await updateProfile({ name: name.trim() || profile.name, goals })
    props.onSaved()
    props.onClose()
  }

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">⚙️ Profile &amp; goals</h3>

        <label className="field">
          <span className="field__label">Display name</span>
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <p className="modal__hint">Daily goals (leave blank for no goal):</p>
        <div className="field-row">
          <label className="field">
            <span className="field__label">Calories</span>
            <input
              className="text-input"
              type="number"
              min="0"
              value={cal}
              onChange={(e) => setCal(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Protein (g)</span>
            <input
              className="text-input"
              type="number"
              min="0"
              value={protein}
              onChange={(e) => setProtein(e.target.value)}
            />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field__label">Carbs (g)</span>
            <input
              className="text-input"
              type="number"
              min="0"
              value={carbs}
              onChange={(e) => setCarbs(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Fat (g)</span>
            <input
              className="text-input"
              type="number"
              min="0"
              value={fat}
              onChange={(e) => setFat(e.target.value)}
            />
          </label>
        </div>

        <button className="link-btn" onClick={() => setCalcOpen((o) => !o)}>
          ✨ {calcOpen ? 'Hide the goal calculator' : 'Calculate goals from my stats'}
        </button>

        {calcOpen && (
          <div className="goal-calc">
            <div className="tabs">
              {(['male', 'female'] as const).map((s) => (
                <button
                  key={s}
                  className={`tabs__tab ${sex === s ? 'tabs__tab--active' : ''}`}
                  onClick={() => setSex(s)}
                >
                  {s === 'male' ? 'Male' : 'Female'}
                </button>
              ))}
            </div>
            <div className="field-row">
              <label className="field">
                <span className="field__label">Age</span>
                <input
                  className="text-input"
                  type="number"
                  min="10"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">Height (cm)</span>
                <input
                  className="text-input"
                  type="number"
                  min="100"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">Weight (kg)</span>
                <input
                  className="text-input"
                  type="number"
                  min="30"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span className="field__label">Activity</span>
              <select
                className="text-input"
                value={activity}
                onChange={(e) => setActivity(e.target.value as ActivityLevel)}
              >
                {ACTIVITY_LEVELS.map((a) => (
                  <option key={a} value={a}>
                    {ACTIVITY_LABEL[a]}
                  </option>
                ))}
              </select>
            </label>
            <div className="tabs">
              {(Object.keys(DIRECTION_LABEL) as GoalDirection[]).map((d) => (
                <button
                  key={d}
                  className={`tabs__tab ${direction === d ? 'tabs__tab--active' : ''}`}
                  onClick={() => setDirection(d)}
                >
                  {DIRECTION_LABEL[d]}
                </button>
              ))}
            </div>
            {calculated ? (
              <p className="goal-calc__preview">
                ≈ {calculated.calories.toLocaleString()} kcal · P {calculated.protein}g · C{' '}
                {calculated.carbs}g · F {calculated.fat}g — best-guess estimate (Mifflin-St Jeor)
              </p>
            ) : (
              <p className="modal__hint">Fill in age, height and weight for an estimate.</p>
            )}
            <button className="btn" disabled={!calculated} onClick={applyCalculated}>
              Use these goals
            </button>
          </div>
        )}

        <div className="modal__actions">
          <button className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
