import { useState } from 'react'
import type { JSX } from 'react'
import { CUISINES, CUISINE_LABEL, DIET_TAGS, DIET_LABEL } from '../../shared/types'
import type { Cuisine, DietTag, RecipeSummary } from '../../shared/types'
import { useHousehold } from '../hooks/useHousehold'
import { recipeInitial, recipeTone } from '../lib/recipeTone'

type Tab = 'mine' | 'catalog'

function timeChip(totalMin: number | null): string | null {
  if (totalMin === null) return null
  if (totalMin < 60) return `${totalMin} min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`
}

/** "Keeps 3 days" is the fact that decides whether a recipe can carry a leftover night,
 *  so it earns a place on the card rather than being buried in the detail page. */
function keepsChip(r: RecipeSummary): string | null {
  if (!r.isCatalog) return null
  if (r.reheat === 'fresh-only') return 'Eat fresh'
  if (r.keepsDays <= 0) return null
  return r.keepsDays === 1 ? 'Keeps 1 day' : `Keeps ${r.keepsDays} days`
}

export function LibraryPage(props: {
  recipes: RecipeSummary[]
  onOpen: (id: number) => void
  onImport: () => void
}): JSX.Element {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('mine')
  const [cuisine, setCuisine] = useState<Cuisine | null>(null)
  const [diet, setDiet] = useState<DietTag | null>(null)
  const [quickOnly, setQuickOnly] = useState(false)

  const users = useHousehold()
  const me = users.find((u) => u.isMe)
  const partnerInitial = (ownerId: string): string | null => {
    // Chip only for the partner's recipes — your own need no label.
    if (!me || ownerId === me.id) return null
    const name = users.find((u) => u.id === ownerId)?.name ?? 'Partner'
    return name.trim().charAt(0).toUpperCase()
  }

  // The catalog ships with the app and every recipe is already loaded, so both tabs are a
  // client-side split of one list — no second query, and realtime keeps working.
  const mine = props.recipes.filter((r) => !r.isCatalog)
  const catalog = props.recipes.filter((r) => r.isCatalog)
  const pool = tab === 'mine' ? mine : catalog

  // Cuisines that actually appear, so the chip row never offers a dead filter.
  const availableCuisines = CUISINES.filter((c) => catalog.some((r) => r.cuisine === c))

  const filtered = pool.filter((r) => {
    if (!r.title.toLowerCase().includes(search.toLowerCase())) return false
    if (tab === 'catalog') {
      if (cuisine !== null && r.cuisine !== cuisine) return false
      if (diet !== null && !r.dietTags.includes(diet)) return false
      if (quickOnly && r.effort === 'medium') return false
    }
    return true
  })

  const clearFilters = (): void => {
    setCuisine(null)
    setDiet(null)
    setQuickOnly(false)
  }
  const anyFilter = cuisine !== null || diet !== null || quickOnly

  const emptyMessage =
    tab === 'mine'
      ? mine.length === 0
        ? 'No recipes of your own yet. Import one, or save something from the catalog.'
        : 'No recipes match your search.'
      : catalog.length === 0
        ? 'The recipe catalog has not been seeded into this project yet.'
        : 'No catalog recipes match those filters.'

  return (
    <div className="library">
      <div className="library__title-row">
        <span className="library__title">Recipes</span>
        <button className="btn-ghost" onClick={props.onImport}>
          + Import
        </button>
      </div>

      <div className="segmented" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'mine'}
          className={`segmented__btn ${tab === 'mine' ? 'segmented__btn--on' : ''}`}
          onClick={() => setTab('mine')}
        >
          Mine <span className="segmented__count">{mine.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'catalog'}
          className={`segmented__btn ${tab === 'catalog' ? 'segmented__btn--on' : ''}`}
          onClick={() => setTab('catalog')}
        >
          Catalog <span className="segmented__count">{catalog.length}</span>
        </button>
      </div>

      <input
        className="input-pill library__search"
        placeholder={tab === 'mine' ? 'Search your recipes' : 'Search the catalog'}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {tab === 'catalog' && (
        <div className="filter-rows">
          <div className="chip-row">
            {availableCuisines.map((c) => (
              <button
                key={c}
                className={`filter-chip ${cuisine === c ? 'filter-chip--on' : ''}`}
                onClick={() => setCuisine(cuisine === c ? null : c)}
              >
                {CUISINE_LABEL[c]}
              </button>
            ))}
          </div>
          <div className="chip-row">
            {DIET_TAGS.map((d) => (
              <button
                key={d}
                className={`filter-chip ${diet === d ? 'filter-chip--on' : ''}`}
                onClick={() => setDiet(diet === d ? null : d)}
              >
                {DIET_LABEL[d]}
              </button>
            ))}
            <button
              className={`filter-chip ${quickOnly ? 'filter-chip--on' : ''}`}
              onClick={() => setQuickOnly(!quickOnly)}
            >
              Quick
            </button>
            {anyFilter && (
              <button className="filter-chip filter-chip--clear" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="library__empty">{emptyMessage}</p>
      ) : (
        <div className="library__grid">
          {filtered.map((r) => {
            const meta = [timeChip(r.totalMin), r.est ? `~${Math.round(r.est.calories)} kcal` : null]
              .filter(Boolean)
              .join(' · ')
            const keeps = keepsChip(r)
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
                    {partnerInitial(r.ownerId) && !r.isCatalog && (
                      <span className="recipe-card__by">{partnerInitial(r.ownerId)}</span>
                    )}
                  </div>
                  {keeps && <span className="recipe-card__keeps">{keeps}</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
