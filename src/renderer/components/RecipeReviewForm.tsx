import { useState } from 'react'
import type { JSX } from 'react'
import type { DraftRecipe, RecipeStep } from '../../shared/types'
import { parseIngredient } from '../../shared/ingredient-parser'

const CONFIDENCE_NOTE: Record<DraftRecipe['confidence'], { text: string; cls: string } | null> = {
  structured: { text: '✓ Parsed from structured recipe data', cls: 'banner--ok' },
  heuristic: { text: '⚠ Best-effort parse — please check everything below', cls: 'banner--warn' },
  manual: null
}

export function RecipeReviewForm(props: {
  draft: DraftRecipe
  onCancel: () => void
  onSaved: (id: number) => void
}): JSX.Element {
  const [title, setTitle] = useState(props.draft.title)
  const [description, setDescription] = useState(props.draft.description)
  const [servings, setServings] = useState(props.draft.servings?.toString() ?? '')
  const [prepMin, setPrepMin] = useState(props.draft.prepMin?.toString() ?? '')
  const [cookMin, setCookMin] = useState(props.draft.cookMin?.toString() ?? '')
  const [ingredientText, setIngredientText] = useState(
    props.draft.ingredients.map((i) => i.raw).join('\n')
  )
  const [steps, setSteps] = useState<RecipeStep[]>(
    props.draft.steps.length ? props.draft.steps : [{ position: 0, section: null, text: '' }]
  )
  const [saving, setSaving] = useState(false)

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
    const draft: DraftRecipe = {
      ...props.draft,
      title: title.trim(),
      description: description.trim(),
      servings: num(servings),
      prepMin: prep,
      cookMin: cook,
      totalMin:
        props.draft.totalMin ?? (prep !== null || cook !== null ? (prep ?? 0) + (cook ?? 0) : null),
      ingredients: ingredientText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l, position) => ({ position, ...parseIngredient(l) })),
      steps: steps
        .filter((s) => s.text.trim().length > 0)
        .map((s, position) => ({ ...s, position, text: s.text.trim() }))
    }
    const id = await window.api.saveRecipe(draft)
    props.onSaved(id)
  }

  return (
    <div className="review-form">
      <h2 className="page-header__title">Review recipe</h2>
      {note && <div className={`banner ${note.cls}`}>{note.text}</div>}

      <label className="field">
        <span className="field__label">Title</span>
        <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="field">
        <span className="field__label">Description</span>
        <textarea
          className="text-input"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Servings</span>
          <input
            className="text-input"
            type="number"
            min="1"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Prep (min)</span>
          <input
            className="text-input"
            type="number"
            min="0"
            value={prepMin}
            onChange={(e) => setPrepMin(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Cook (min)</span>
          <input
            className="text-input"
            type="number"
            min="0"
            value={cookMin}
            onChange={(e) => setCookMin(e.target.value)}
          />
        </label>
      </div>

      <label className="field">
        <span className="field__label">Ingredients (one per line)</span>
        <textarea
          className="text-input review-form__ingredients"
          rows={Math.max(6, ingredientText.split('\n').length + 1)}
          value={ingredientText}
          onChange={(e) => setIngredientText(e.target.value)}
        />
      </label>

      <div className="field">
        <span className="field__label">Steps</span>
        {steps.map((s, idx) => (
          <div key={idx} className="review-form__step">
            {s.section && <span className="review-form__section">{s.section}</span>}
            <div className="review-form__step-row">
              <span className="review-form__step-num">{idx + 1}.</span>
              <textarea
                className="text-input review-form__step-text"
                rows={2}
                value={s.text}
                onChange={(e) => updateStep(idx, e.target.value)}
              />
              <div className="review-form__step-btns">
                <button className="icon-btn" title="Move up" onClick={() => moveStep(idx, -1)}>
                  ↑
                </button>
                <button className="icon-btn" title="Move down" onClick={() => moveStep(idx, 1)}>
                  ↓
                </button>
                <button className="icon-btn" title="Remove" onClick={() => removeStep(idx)}>
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))}
        <button className="btn" onClick={addStep}>
          + Add step
        </button>
      </div>

      <div className="review-form__actions">
        <button className="btn" onClick={props.onCancel} disabled={saving}>
          Back
        </button>
        <button
          className="btn btn--primary"
          onClick={save}
          disabled={saving || !title.trim()}
        >
          {saving ? 'Saving…' : 'Save recipe'}
        </button>
      </div>
    </div>
  )
}
