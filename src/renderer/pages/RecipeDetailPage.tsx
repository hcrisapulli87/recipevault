import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Recipe } from '../../shared/types'
import { scaleIngredient, formatQuantity } from '../../shared/ingredient-parser'
import { CookingMode } from '../components/CookingMode'
import { GroceryPreviewModal } from '../components/GroceryPreviewModal'

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

  useEffect(() => {
    window.api.getRecipe(props.recipeId).then((r) => {
      setRecipe(r)
      setServings(r?.servings ?? 1)
    })
  }, [props.recipeId])

  if (!recipe || servings === null) return <p className="empty-note">Loading…</p>

  const baseServings = recipe.servings ?? 1
  const factor = servings / baseServings

  const remove = async (): Promise<void> => {
    if (!window.confirm(`Delete “${recipe.title}”? This can't be undone.`)) return
    await window.api.deleteRecipe(recipe.id)
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
            {recipe.prepMin !== null && <span className="chip">Prep {recipe.prepMin} min</span>}
            {recipe.cookMin !== null && <span className="chip">Cook {recipe.cookMin} min</span>}
            {recipe.totalMin !== null && <span className="chip">Total {recipe.totalMin} min</span>}
            {recipe.sourceUrl && (
              <button
                className="link-btn"
                onClick={() => window.api.openExternal(recipe.sourceUrl!)}
              >
                Source ↗
              </button>
            )}
          </div>
          <div className="detail__actions">
            <button className="btn btn--primary" onClick={() => setCooking(true)}>
              🍳 Cook
            </button>
            <button className="btn" onClick={() => setGroceryOpen(true)}>
              🛒 Send ingredients to groceries
            </button>
            <button className="btn btn--danger" onClick={remove}>
              Delete
            </button>
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
