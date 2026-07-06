import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Recipe, RecipeEstimate } from '../../shared/types'
import { scaleIngredient, formatQuantity } from '../../shared/ingredient-parser'
import type { EstimateDetail } from '../../shared/macro-estimator'
import { getRecipe, deleteRecipe } from '../data/recipes'
import { computeRecipeEstimate, saveRecipeEstimate } from '../data/macroEstimate'
import { CookingMode } from '../components/CookingMode'
import { GroceryPreviewModal } from '../components/GroceryPreviewModal'
import { useHousehold } from '../hooks/useHousehold'

function formatIngredient(ing: Recipe['ingredients'][number], factor: number): string {
  const scaled = scaleIngredient(ing, factor)
  if (scaled.quantity === null) return scaled.raw
  let qty = formatQuantity(scaled.quantity)
  if (scaled.quantityMax !== null) qty += `–${formatQuantity(scaled.quantityMax)}`
  return [qty, scaled.unit, scaled.name].filter(Boolean).join(' ')
}

export function RecipeDetailPage(props: {
  recipeId: number
  onBack: () => void
  onDeleted: () => void
}): JSX.Element {
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [servings, setServings] = useState<number | null>(null)
  const [cooking, setCooking] = useState(false)
  const [groceryOpen, setGroceryOpen] = useState(false)
  const [est, setEst] = useState<RecipeEstimate | null>(null)
  const [estDetail, setEstDetail] = useState<EstimateDetail[] | null>(null)
  const [estimating, setEstimating] = useState(false)
  const users = useHousehold()
  const me = users.find((u) => u.isMe)
  const ownerName =
    recipe && me && recipe.ownerId !== me.id
      ? (users.find((u) => u.id === recipe.ownerId)?.name ?? 'Partner')
      : null

  useEffect(() => {
    getRecipe(props.recipeId).then((r) => {
      setRecipe(r)
      setServings(r?.servings ?? 1)
      setEst(r?.est ?? null)
      setEstDetail(null)
    })
  }, [props.recipeId])

  if (!recipe || servings === null) return <p className="empty-note">Loading…</p>

  const baseServings = recipe.servings ?? 1
  const factor = servings / baseServings

  const recalc = async (): Promise<void> => {
    if (!recipe) return
    setEstimating(true)
    try {
      const out = await computeRecipeEstimate(recipe)
      await saveRecipeEstimate(recipe.id, out.estimate)
      setEst(out.estimate)
      setEstDetail(out.detail)
    } finally {
      setEstimating(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!window.confirm(`Delete “${recipe.title}”? This can't be undone.`)) return
    await deleteRecipe(recipe.id)
    props.onDeleted()
  }

  return (
    <div className="detail">
      <button className="link-btn" onClick={props.onBack}>
        ← All recipes
      </button>

      <div className="detail__hero">
        {recipe.imageUrl && <img className="detail__image" src={recipe.imageUrl} alt="" />}
        <div className="detail__head">
          <h2 className="detail__title">{recipe.title}</h2>
          {recipe.description && <p className="detail__description">{recipe.description}</p>}
          <div className="detail__chips">
            {ownerName && <span className="chip">👤 added by {ownerName}</span>}
            {recipe.prepMin !== null && <span className="chip">Prep {recipe.prepMin} min</span>}
            {recipe.cookMin !== null && <span className="chip">Cook {recipe.cookMin} min</span>}
            {recipe.totalMin !== null && <span className="chip">Total {recipe.totalMin} min</span>}
            {recipe.sourceUrl && (
              <button
                className="link-btn"
                onClick={() => window.open(recipe.sourceUrl!, '_blank', 'noopener')}
              >
                Source ↗
              </button>
            )}
          </div>
          <div className="est-block">
            {est ? (
              <>
                <span className="est-block__line">
                  ≈ {Math.round(est.calories)} kcal · P {est.protein} / C {est.carbs} / F{' '}
                  {est.fat} g per serve{est.assumedServings ? ' (assumes 4 serves)' : ''}
                </span>
                <span className="est-block__meta">
                  best guess — matched {est.matched} of {est.total} ingredients
                </span>
              </>
            ) : (
              <span className="est-block__meta">No macro estimate yet.</span>
            )}
            {me && recipe.ownerId === me.id && (
              <button className="link-btn" onClick={recalc} disabled={estimating}>
                {estimating ? 'Estimating…' : est ? '♻️ Recalculate' : 'Estimate macros'}
              </button>
            )}
            {estDetail && (
              <ul className="est-breakdown">
                {estDetail.map((d, i) => (
                  <li key={i} className={d.matched ? '' : 'est-breakdown__miss'}>
                    {d.matched
                      ? `${d.name} — ${Math.round(d.grams ?? 0)} g · ${d.calories} kcal`
                      : `${d.name} — not matched`}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="detail__actions">
            <button
              className="btn btn--primary"
              onClick={() => setCooking(true)}
              disabled={recipe.steps.length === 0}
              title={recipe.steps.length === 0 ? 'This recipe has no steps' : undefined}
            >
              🍳 Cook
            </button>
            <button className="btn" onClick={() => setGroceryOpen(true)}>
              🛒 Send ingredients to groceries
            </button>
            {/* Delete is owner-only; RLS refuses it server-side regardless. */}
            {me && recipe.ownerId === me.id && (
              <button className="btn btn--danger" onClick={remove}>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="detail__columns">
        <section className="detail__ingredients">
          <div className="detail__section-head">
            <h3>Ingredients</h3>
            <div className="servings-stepper">
              <button
                className="icon-btn"
                onClick={() => setServings(Math.max(1, servings - 1))}
                disabled={servings <= 1}
              >
                −
              </button>
              <span className="servings-stepper__count">{servings} servings</span>
              <button className="icon-btn" onClick={() => setServings(servings + 1)}>
                +
              </button>
            </div>
          </div>
          <ul className="ingredient-list">
            {recipe.ingredients.map((ing) => (
              <li key={ing.position}>{formatIngredient(ing, factor)}</li>
            ))}
          </ul>
        </section>

        <section className="detail__steps">
          <h3>Steps</h3>
          <ol className="step-list">
            {recipe.steps.map((s, idx) => (
              <li key={s.position}>
                {s.section && (idx === 0 || recipe.steps[idx - 1].section !== s.section) && (
                  <span className="step-list__section">{s.section}</span>
                )}
                {s.text}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {cooking && <CookingMode recipe={recipe} onClose={() => setCooking(false)} />}
      {groceryOpen && (
        <GroceryPreviewModal
          recipeIds={[recipe.id]}
          scales={{ [recipe.id]: factor }}
          onClose={() => setGroceryOpen(false)}
        />
      )}
    </div>
  )
}
