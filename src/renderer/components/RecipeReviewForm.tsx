import { useState } from 'react'
import type { JSX } from 'react'
import { ArrowUp, ArrowDown, X } from 'lucide-react'
import type { DraftRecipe, RecipeStep } from '../../shared/types'
import { parseIngredient } from '../../shared/ingredient-parser'
import { saveRecipe } from '../data/recipes'
import { estimateAndSave } from '../data/macroEstimate'
import { convertDraftToMetric } from '../../shared/unit-convert'
import { useToast } from './Toast'

const CONFIDENCE_NOTE: Record<DraftRecipe['confidence'], { text: string; warm: boolean } | null> = {
  structured: {
    text: 'Scraped from link — check everything before saving. Macros are estimates.',
    warm: false
  },
  heuristic: {
    text: 'Best-effort parse — check everything before saving. Macros are estimates.',
    warm: true
  },
  manual: null
}

export function RecipeReviewForm(props: {
  draft: DraftRecipe
  onCancel: () => void
  onSaved: (id: number) => void
}): JSX.Element {
  const toast = useToast()
  // American imports read in Australian units: oz/lb → g, °F → °C (exact conversions
  // only — cups/spoons stay). Runs once; the banner below says what changed.
  const [converted] = useState(() => convertDraftToMetric(props.draft))
  const [title, setTitle] = useState(props.draft.title)
  const [description, setDescription] = useState(props.draft.description)
  const [servings, setServings] = useState(props.draft.servings?.toString() ?? '')
  const [prepMin, setPrepMin] = useState(props.draft.prepMin?.toString() ?? '')
  const [cookMin, setCookMin] = useState(props.draft.cookMin?.toString() ?? '')
  const [ingredientText, setIngredientText] = useState(
    converted.draft.ingredients.map((i) => i.raw).join('\n')
  )
  const [steps, setSteps] = useState<RecipeStep[]>(
    converted.draft.steps.length
      ? converted.draft.steps
      : [{ position: 0, section: null, text: '' }]
  )
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const note = CONFIDENCE_NOTE[props.draft.confidence]

  const updateStep = (idx: number, text: string): void =>
    setSteps(steps.map((s, i) => (i === idx ? { ...s, text } : s)))

  const moveStep = (idx: number, delta: -1 | 1): void => {
    const target = idx + delta
    if (target < 0 || target >= steps.length) return
    const next = [...steps]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setSteps(next)
  }

  const removeStep = (idx: number): void => setSteps(steps.filter((_, i) => i !== idx))

  const addStep = (): void =>
    setSteps([...steps, { position: steps.length, section: null, text: '' }])

  const save = async (): Promise<void> => {
    if (!title.trim()) return
    setSaving(true)
    const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))
    const prep = num(prepMin)
    const cook = num(cookMin)
    // the scraped total may include resting/chilling time, so keep it — but only
    // while prep/cook are untouched; once the user edits them it's stale
    const timesUntouched = prep === props.draft.prepMin && cook === props.draft.cookMin
    const draft: DraftRecipe = {
      ...props.draft,
      title: title.trim(),
      description: description.trim(),
      servings: num(servings),
      prepMin: prep,
      cookMin: cook,
      totalMin:
        timesUntouched && props.draft.totalMin !== null
          ? props.draft.totalMin
          : prep !== null || cook !== null
            ? (prep ?? 0) + (cook ?? 0)
            : null,
      ingredients: ingredientText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l, position) => ({ position, ...parseIngredient(l) })),
      steps: steps
        .filter((s) => s.text.trim().length > 0)
        .map((s, position) => ({ ...s, position, text: s.text.trim() }))
    }
    setSaveError(null)
    try {
      const id = await saveRecipe(draft)
      void estimateAndSave(id) // background best-guess macros; the detail page can redo it
      toast('Saved to recipes')
      props.onSaved(id)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save — try again.')
      setSaving(false)
    }
  }

  return (
    <div className="review-form">
      <h2 className="review-form__title">Review recipe</h2>
      {note && (
        <div className={`info-banner ${note.warm ? 'info-banner--warm' : ''}`}>{note.text}</div>
      )}
      {converted.measurements + converted.temps > 0 && (
        <div className="info-banner">
          Converted to metric: {converted.measurements} measurement
          {converted.measurements === 1 ? '' : 's'}, {converted.temps} temperature
          {converted.temps === 1 ? '' : 's'}.
        </div>
      )}

      <label className="ffield">
        <span className="ffield__label">Title</span>
        <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="ffield">
        <span className="ffield__label">Description</span>
        <textarea
          className="input-field input-field--area"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="ffield-row">
        <label className="ffield">
          <span className="ffield__label">Servings</span>
          <input
            className="input-field"
            type="number"
            min="1"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
          />
        </label>
        <label className="ffield">
          <span className="ffield__label">Prep (min)</span>
          <input
            className="input-field"
            type="number"
            min="0"
            value={prepMin}
            onChange={(e) => setPrepMin(e.target.value)}
          />
        </label>
        <label className="ffield">
          <span className="ffield__label">Cook (min)</span>
          <input
            className="input-field"
            type="number"
            min="0"
            value={cookMin}
            onChange={(e) => setCookMin(e.target.value)}
          />
        </label>
      </div>

      <label className="ffield">
        <span className="ffield__label">Ingredients (one per line)</span>
        <textarea
          className="input-field input-field--area review-form__ingredients"
          rows={Math.max(6, ingredientText.split('\n').length + 1)}
          value={ingredientText}
          onChange={(e) => setIngredientText(e.target.value)}
        />
      </label>

      <div className="ffield">
        <span className="ffield__label">Steps</span>
        {steps.map((s, idx) => (
          <div key={idx} className="review-form__step">
            {s.section && <span className="review-form__section">{s.section}</span>}
            <div className="review-form__step-row">
              <span className="review-form__step-num">{idx + 1}.</span>
              <textarea
                className="input-field input-field--area review-form__step-text"
                rows={2}
                value={s.text}
                onChange={(e) => updateStep(idx, e.target.value)}
              />
              <div className="review-form__step-btns">
                <button
                  className="round-btn"
                  aria-label="Move up"
                  onClick={() => moveStep(idx, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  className="round-btn"
                  aria-label="Move down"
                  onClick={() => moveStep(idx, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button className="round-btn" aria-label="Remove" onClick={() => removeStep(idx)}>
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        <button className="btn-secondary review-form__add-step" onClick={addStep}>
          + Add step
        </button>
      </div>

      {saveError && <div className="info-banner info-banner--warm">{saveError}</div>}
      <div className="review-form__actions">
        <button className="btn-secondary" onClick={props.onCancel} disabled={saving}>
          Back
        </button>
        <button className="btn-primary" onClick={save} disabled={saving || !title.trim()}>
          {saving ? 'Saving…' : 'Save recipe'}
        </button>
      </div>
    </div>
  )
}
