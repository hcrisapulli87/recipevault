import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { Recipe, RecipeEstimate } from '../../shared/types'
import { scaleIngredient, formatQuantity } from '../../shared/ingredient-parser'
import type { EstimateDetail } from '../../shared/macro-estimator'
import { getRecipe, deleteRecipe, copyToLibrary } from '../data/recipes'
import { CUISINE_LABEL, DIET_LABEL } from '../../shared/types'
import { computeRecipeEstimate, saveRecipeEstimate } from '../data/macroEstimate'
import { convertRecipeToMetric } from '../data/metricConvert'
import { hasImperialUnits } from '../../shared/unit-convert'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { CookingMode } from '../components/CookingMode'
import { GroceryPreviewModal } from '../components/GroceryPreviewModal'
import { useHousehold } from '../hooks/useHousehold'
import { recipeInitial, recipeTone } from '../lib/recipeTone'

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
  /** A catalog recipe was forked into the user's own library; opens the copy. */
  onCopied: (newId: number) => void
}): JSX.Element {
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [servings, setServings] = useState<number | null>(null)
  const [cooking, setCooking] = useState(false)
  const [groceryOpen, setGroceryOpen] = useState(false)
  const [est, setEst] = useState<RecipeEstimate | null>(null)
  const [estDetail, setEstDetail] = useState<EstimateDetail[] | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // All hooks stay ABOVE the loading early-return — a hook below it crashes the
  // page the moment the recipe arrives (hook count changes between renders).
  const [converting, setConverting] = useState(false)
  const [copying, setCopying] = useState(false)
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

  if (!recipe || servings === null) return <p className="library__empty">Loading…</p>

  const baseServings = recipe.servings ?? 1
  const factor = servings / baseServings
  const isOwner = me != null && recipe.ownerId === me.id
  const canEdit = isOwner && !recipe.isCatalog

  const convertMetric = async (): Promise<void> => {
    if (!recipe) return
    setConverting(true)
    try {
      await convertRecipeToMetric(recipe)
      const fresh = await getRecipe(recipe.id)
      setRecipe(fresh)
      setEst(fresh?.est ?? null)
      setEstDetail(null)
    } finally {
      setConverting(false)
    }
  }

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
    await deleteRecipe(recipe.id)
    props.onDeleted()
  }

  /** Fork a catalog recipe into your own library so it can be edited and deleted. */
  const saveToLibrary = async (): Promise<void> => {
    setCopying(true)
    try {
      const id = await copyToLibrary(recipe.id)
      props.onCopied(id)
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="rdetail">
      {/* 200px tone/photo header with the glass back button */}
      <div
        className="rdetail__header"
        style={
          recipe.imageUrl
            ? undefined
            : { background: `linear-gradient(160deg, ${recipeTone(recipe.title)}, #eef3f0 260%)` }
        }
      >
        {recipe.imageUrl ? (
          <img className="rdetail__photo" src={recipe.imageUrl} alt="" />
        ) : (
          <span className="rdetail__initial">{recipeInitial(recipe.title)}</span>
        )}
        <button className="rdetail__back" aria-label="Back" onClick={props.onBack}>
          <ChevronLeft size={18} strokeWidth={2.4} />
        </button>
      </div>

      <div className="rdetail__body">
        <h2 className="rdetail__title">{recipe.title}</h2>
        {recipe.description && <p className="rdetail__description">{recipe.description}</p>}

        <div className="rdetail__chips">
          {recipe.totalMin !== null && <span className="glass-chip">{recipe.totalMin} min</span>}
          {est && (
            <span className="glass-chip">~{Math.round(est.calories)} kcal / serve · est.</span>
          )}
          {recipe.isCatalog && recipe.cuisine && (
            <span className="glass-chip glass-chip--tint">{CUISINE_LABEL[recipe.cuisine]}</span>
          )}
          {recipe.isCatalog &&
            recipe.dietTags.map((t) => (
              <span key={t} className="glass-chip">
                {DIET_LABEL[t]}
              </span>
            ))}
          {/* Fridge life is what decides whether the planner can chain this into a
              leftover night, so it belongs on the recipe, not only in the plan. */}
          {recipe.isCatalog && recipe.reheat === 'fresh-only' && (
            <span className="glass-chip">Eat fresh · does not keep</span>
          )}
          {recipe.isCatalog && recipe.reheat !== 'fresh-only' && recipe.keepsDays > 0 && (
            <span className="glass-chip">
              Keeps {recipe.keepsDays} day{recipe.keepsDays === 1 ? '' : 's'}
              {recipe.reheat ? ` · reheat in the ${recipe.reheat}` : ''}
            </span>
          )}
          {ownerName && !recipe.isCatalog && (
            <span className="glass-chip glass-chip--tint">Added by {ownerName}</span>
          )}
          {recipe.sourceUrl && (
            <button
              className="glass-chip glass-chip--link"
              onClick={() => window.open(recipe.sourceUrl!, '_blank', 'noopener')}
            >
              Source ↗
            </button>
          )}
        </div>

        {est && (
          <div className="rdetail__macros">
            <span>P {est.protein} g</span>
            <span>C {est.carbs} g</span>
            <span>F {est.fat} g</span>
            <span className="rdetail__macros-note">per serve</span>
          </div>
        )}

        <section className="rdetail__island glass-island">
          <div className="rdetail__island-head">
            <span className="rdetail__island-title">Ingredients</span>
            <div className="rdetail__scaler">
              <button
                className="round-btn rdetail__scale-btn"
                aria-label="Fewer serves"
                onClick={() => setServings(Math.max(1, servings - 1))}
                disabled={servings <= 1}
              >
                −
              </button>
              <span className="rdetail__scale-label">
                {servings} serve{servings === 1 ? '' : 's'}
              </span>
              <button
                className="round-btn rdetail__scale-btn"
                aria-label="More serves"
                onClick={() => setServings(servings + 1)}
              >
                +
              </button>
            </div>
          </div>
          {recipe.ingredients.map((ing) => (
            <div key={ing.position} className="rdetail__ingredient">
              {formatIngredient(ing, factor)}
            </div>
          ))}
        </section>

        <section className="rdetail__island glass-island">
          <div className="rdetail__island-title">Method</div>
          {recipe.steps.map((s, idx) => (
            <div key={s.position}>
              {s.section && (idx === 0 || recipe.steps[idx - 1].section !== s.section) && (
                <div className="rdetail__section">{s.section}</div>
              )}
              <div className="rdetail__step">
                <span className="rdetail__step-num">{String(idx + 1).padStart(2, '0')}</span>
                <span className="rdetail__step-text">{s.text}</span>
              </div>
            </div>
          ))}
          {recipe.steps.length === 0 && (
            <div className="meal-card__empty">No steps saved for this recipe.</div>
          )}
        </section>

        <button
          className="btn-primary rdetail__cook"
          onClick={() => setCooking(true)}
          disabled={recipe.steps.length === 0}
        >
          Start cooking mode
        </button>

        {/* Secondary actions. Estimate/convert/delete are owner-only (RLS enforces it
            server-side too) AND withheld on catalog rows: those are seeded data owned by
            whoever ran the seeder, so "is owner" would otherwise let one household member
            delete a recipe the other has planned. Fork it first instead. */}
        <div className="rdetail__actions">
          <button className="btn-ghost" onClick={() => setGroceryOpen(true)}>
            Send ingredients to groceries
          </button>
          {recipe.isCatalog && (
            <button className="btn-ghost" onClick={saveToLibrary} disabled={copying}>
              {copying ? 'Saving…' : 'Save to my recipes'}
            </button>
          )}
          {canEdit && (
            <button className="btn-ghost" onClick={recalc} disabled={estimating}>
              {estimating ? 'Estimating…' : est ? 'Recalculate estimate' : 'Estimate macros'}
            </button>
          )}
          {canEdit && hasImperialUnits(recipe) && (
            <button className="btn-ghost" onClick={convertMetric} disabled={converting}>
              {converting ? 'Converting…' : 'Convert to metric'}
            </button>
          )}
          {canEdit && (
            <button
              className="btn-ghost btn-ghost--destructive"
              onClick={() => setConfirmDelete(true)}
            >
              Delete recipe
            </button>
          )}
        </div>
        {est && (
          <p className="rdetail__est-meta">
            Best guess — matched {est.matched} of {est.total} ingredients
            {est.assumedServings ? ' (assumes 4 serves)' : ''}.
          </p>
        )}
        {estDetail && (
          <ul className="rdetail__est-breakdown">
            {estDetail.map((d, i) => (
              <li key={i} className={d.matched ? '' : 'rdetail__est-miss'}>
                {d.matched
                  ? `${d.name} — ${Math.round(d.grams ?? 0)} g · ${d.calories} kcal`
                  : `${d.name} — not matched`}
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirmDelete && (
        <ConfirmSheet
          title={`Delete “${recipe.title}”?`}
          body="The recipe, its ingredients and steps are removed. This can't be undone."
          confirmLabel="Delete recipe"
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}

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
