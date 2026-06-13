import { useState } from 'react'
import type { JSX } from 'react'
import type { RecipeSummary } from '../../shared/types'

function timeChip(totalMin: number | null): string | null {
  if (totalMin === null) return null
  if (totalMin < 60) return `${totalMin} min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

export function LibraryPage(props: {
  recipes: RecipeSummary[]
  onOpen: (id: number) => void
  onImport: () => void
}): JSX.Element {
  const [search, setSearch] = useState('')
  const filtered = props.recipes.filter((r) => r.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div className="page-header">
        <h2 className="page-header__title">Recipes</h2>
        <input
          className="text-input"
          placeholder="Search recipes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn btn--primary" onClick={props.onImport}>
          + Import recipe
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="empty-note">
          {props.recipes.length === 0
            ? 'No recipes yet. Paste a recipe URL via “Import recipe” to get started.'
            : 'No recipes match your search.'}
        </p>
      ) : (
        <div className="recipe-grid">
          {filtered.map((r) => (
            <button key={r.id} className="recipe-card" onClick={() => props.onOpen(r.id)}>
              <div className="recipe-card__image-wrapper">
                {r.imageUrl ? (
                  <img className="recipe-card__image" src={r.imageUrl} alt="" />
                ) : (
                  <span className="recipe-card__placeholder">🍽️</span>
                )}
              </div>
              <div className="recipe-card__info">
                <span className="recipe-card__title">{r.title}</span>
                {timeChip(r.totalMin) && (
                  <span className="recipe-card__time">⏱ {timeChip(r.totalMin)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
