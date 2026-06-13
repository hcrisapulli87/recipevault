import { useState } from 'react'
import type { JSX } from 'react'
import type { DraftRecipe } from '../../shared/types'
import { RecipeReviewForm } from '../components/RecipeReviewForm'

const EMPTY_DRAFT: DraftRecipe = {
  title: '',
  sourceUrl: null,
  imageUrl: null,
  description: '',
  servings: null,
  prepMin: null,
  cookMin: null,
  totalMin: null,
  ingredients: [],
  steps: [],
  confidence: 'manual'
}

export function ImportPage(props: { onSaved: (id: number) => void }): JSX.Element {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftRecipe | null>(null)

  const fetchRecipe = async (): Promise<void> => {
    if (!url.trim()) return
    setLoading(true)
    setError(null)
    const result = await window.api.scrapeUrl(url.trim())
    setLoading(false)
    if (result.ok) {
      setDraft(result.data)
    } else {
      setError(result.message)
    }
  }

  if (draft) {
    return (
      <RecipeReviewForm draft={draft} onCancel={() => setDraft(null)} onSaved={props.onSaved} />
    )
  }

  return (
    <div className="import-page">
      <h2 className="page-header__title">Import a recipe</h2>
      <p className="import-page__hint">
        Paste a link to any recipe page. RecipeVault strips it down to just the ingredients and
        steps — no ads, no life stories.
      </p>
      <div className="import-page__row">
        <input
          className="text-input import-page__url"
          placeholder="https://www.bbcgoodfood.com/recipes/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchRecipe()}
          disabled={loading}
        />
        <button
          className="btn btn--primary"
          onClick={fetchRecipe}
          disabled={loading || !url.trim()}
        >
          {loading ? 'Fetching…' : 'Fetch recipe'}
        </button>
      </div>
      {error && (
        <div className="banner banner--error">
          <span>{error}</span>
          <button className="btn" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            Enter manually
          </button>
        </div>
      )}
      <p className="import-page__manual">
        …or{' '}
        <button className="link-btn" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          enter a recipe manually
        </button>
      </p>
    </div>
  )
}
