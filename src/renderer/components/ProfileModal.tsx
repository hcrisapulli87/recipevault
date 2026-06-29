import { useState } from 'react'
import type { JSX } from 'react'
import type { Profile } from '../../shared/types'

const toGoal = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Edit a profile's name + daily macro goals, with an option to delete it. */
export function ProfileModal(props: {
  profile: Profile
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}): JSX.Element {
  const { profile } = props
  const [name, setName] = useState(profile.name)
  const [cal, setCal] = useState(profile.calGoal?.toString() ?? '')
  const [protein, setProtein] = useState(profile.proteinGoal?.toString() ?? '')
  const [carbs, setCarbs] = useState(profile.carbsGoal?.toString() ?? '')
  const [fat, setFat] = useState(profile.fatGoal?.toString() ?? '')

  const save = async (): Promise<void> => {
    await window.api.updateProfile({
      id: profile.id,
      name: name.trim() || profile.name,
      goals: {
        calGoal: toGoal(cal),
        proteinGoal: toGoal(protein),
        carbsGoal: toGoal(carbs),
        fatGoal: toGoal(fat)
      }
    })
    props.onSaved()
    props.onClose()
  }

  const del = async (): Promise<void> => {
    if (
      !window.confirm(`Delete "${profile.name}" and all of its logged meals? This can't be undone.`)
    )
      return
    await window.api.deleteProfile(profile.id)
    props.onDeleted()
    props.onClose()
  }

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">⚙️ Profile & goals</h3>

        <label className="field">
          <span className="field__label">Name</span>
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

        <div className="modal__actions">
          {props.canDelete && (
            <button className="btn btn--danger" onClick={del}>
              Delete profile
            </button>
          )}
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
