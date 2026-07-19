import { useState } from 'react'
import type { JSX } from 'react'
import type { RecipeSummary } from '../../shared/types'
import { useHousehold } from '../hooks/useHousehold'
import { recipeInitial, recipeTone } from '../lib/recipeTone'

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
  const users = useHousehold()
  const me = users.find((u) => u.isMe)
  const partnerInitial = (ownerId: string): string | null => {
    // Chip only for the partner's recipes — your own need no label.
    if (!me || ownerId === me.id) return null
    const name = users.find((u) => u.id === ownerId)?.name ?? 'Partner'
    return name.trim().charAt(0).toUpperCase()
  }
  const filtered = props.recipes.filter((r) => r.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="library">
      <div className="library__title-row">
        <span className="library__title">Recipes</span>
        <button className="btn-ghost" onClick={props.onImport}>
          + Import
        </button>
      </div>
      <input
        className="input-pill library__search"
        placeholder="Search saved recipes"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filtered.length === 0 ? (
        <p className="library__empty">
          {props.recipes.length === 0
            ? 'No recipes yet. Paste a recipe URL via “Import” to get started.'
            : 'No recipes match your search.'}
        </p>
      ) : (
        <div className="library__grid">
          {filtered.map((r) => {
            const meta = [
              timeChip(r.totalMin),
              r.est ? `~${Math.round(r.est.calories)} kcal` : null
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <button
                key={r.id}
                className="recipe-card glass-island"
                onClick={() => props.onOpen(r.id)}
              >
                {r.imageUrl ? (
                  <div className="recipe-card__photo">
                    <img src={r.imageUrl} alt="" />
                  </div>
                ) : (
                  <div
                    className="recipe-card__tone"
                    style={{
                      background: `linear-gradient(160deg, ${recipeTone(r.title)}, #eef3f0 240%)`
                    }}
                  >
                    <span>{recipeInitial(r.title)}</span>
                  </div>
                )}
                <div className="recipe-card__body">
                  <div className="recipe-card__title">{r.title}</div>
                  <div className="recipe-card__meta-row">
                    <span className="recipe-card__meta">{meta}</span>
                    {partnerInitial(r.ownerId) && (
                      <span className="recipe-card__by">{partnerInitial(r.ownerId)}</span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
