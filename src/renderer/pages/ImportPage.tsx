import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DraftRecipe, ImportQueueItem, IpcResult } from '../../shared/types'
import { scrapeUrl } from '../data/scrape'
import { isInstagramUrl, importInstagramDesktop, captionToDraft } from '../data/instagram'
import { queueImport, listMyImports, retryImport, deleteImport } from '../data/importQueue'
import { onTableChange } from '../data/realtime'
import { useHousehold } from '../hooks/useHousehold'
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

const STATUS_LABEL: Record<ImportQueueItem['status'], string> = {
  pending: 'Waiting for your desktop app…',
  fetched: 'Ready to review',
  failed: 'Failed'
}

export function ImportPage(props: { onSaved: (id: number) => void }): JSX.Element {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftRecipe | null>(null)
  const [captionOpen, setCaptionOpen] = useState(false)
  const [captionText, setCaptionText] = useState('')
  const [queue, setQueue] = useState<ImportQueueItem[]>([])
  // Queue row currently open in the review form — deleted once saved.
  const [reviewingId, setReviewingId] = useState<number | null>(null)
  // URL submitted this session; when its row comes back fetched, auto-open review.
  const autoOpenUrl = useRef<string | null>(null)

  const users = useHousehold()
  const meId = users.find((u) => u.isMe)?.id ?? null

  const openFetchedItem = useCallback(async (item: ImportQueueItem): Promise<void> => {
    setLoading(true)
    const res = await captionToDraft(item.caption ?? '', item.uploader, item.url)
    setLoading(false)
    if (res.ok) {
      setReviewingId(item.id)
      setDraft(res.data)
    } else {
      setError(res.message)
    }
  }, [])

  const reloadQueue = useCallback(() => {
    if (!meId) return
    listMyImports(meId).then((items) => {
      setQueue(items)
      const wanted = autoOpenUrl.current
      if (wanted) {
        const hit = items.find((i) => i.url === wanted && i.status === 'fetched')
        if (hit) {
          autoOpenUrl.current = null
          void openFetchedItem(hit)
        }
      }
    })
  }, [meId, openFetchedItem])

  useEffect(() => {
    reloadQueue()
    return onTableChange(['import_queue'], reloadQueue)
  }, [reloadQueue])

  const fetchRecipe = async (): Promise<void> => {
    const u = url.trim()
    if (!u) return
    setLoading(true)
    setError(null)
    let result: IpcResult<DraftRecipe>
    if (isInstagramUrl(u)) {
      if (window.api) {
        result = await importInstagramDesktop(u)
      } else {
        // Phone/web: hand the fetch to the desktop app via the queue.
        try {
          await queueImport(u)
          autoOpenUrl.current = u
          setUrl('')
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not queue the import.')
        }
        setLoading(false)
        return
      }
    } else {
      result = await scrapeUrl(u)
    }
    setLoading(false)
    if (result.ok) setDraft(result.data)
    else setError(result.message)
  }

  const parseCaption = async (): Promise<void> => {
    const text = captionText.trim()
    if (!text) return
    setLoading(true)
    setError(null)
    const source = isInstagramUrl(url.trim()) ? url.trim() : null
    const res = await captionToDraft(text, null, source)
    setLoading(false)
    if (res.ok) {
      setDraft(res.data)
      setCaptionText('')
      setCaptionOpen(false)
    } else {
      setError(res.message)
    }
  }

  if (draft) {
    return (
      <RecipeReviewForm
        draft={draft}
        onCancel={() => {
          setDraft(null)
          setReviewingId(null)
        }}
        onSaved={(id) => {
          if (reviewingId !== null) {
            void deleteImport(reviewingId)
            setReviewingId(null)
          }
          props.onSaved(id)
        }}
      />
    )
  }

  return (
    <div className="import">
      <p className="import__hint">
        Paste a recipe URL or an Instagram reel link. We&rsquo;ll scrape what we can — you review
        before saving.
        {!window.api && ' Instagram links are fetched by your desktop app and appear below.'}
      </p>
      <input
        className="input-pill"
        placeholder="https://www.instagram.com/reel/… or any recipe page"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && fetchRecipe()}
        disabled={loading}
      />
      <button
        className="btn-primary import__fetch"
        onClick={fetchRecipe}
        disabled={loading || !url.trim()}
      >
        {loading ? 'Fetching…' : 'Fetch & review'}
      </button>
      {error && (
        <div className="info-banner info-banner--warm">
          <span>{error}</span>
          <span className="info-banner__actions">
            <button className="btn-secondary" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
              Enter manually
            </button>
          </span>
        </div>
      )}

      {queue.length > 0 && (
        <div className="import__queue glass-island">
          {queue.map((item) => (
            <div key={item.id} className="import-row">
              <div className="import-row__info">
                <span className="import-row__url">{item.url}</span>
                <span
                  className={`import-row__status import-row__status--${item.status}`}
                >
                  {STATUS_LABEL[item.status]}
                  {item.status === 'failed' && item.error ? ` — ${item.error}` : ''}
                </span>
              </div>
              {item.status === 'fetched' && (
                <button className="btn-secondary import-row__btn" onClick={() => void openFetchedItem(item)}>
                  Review
                </button>
              )}
              {item.status === 'failed' && (
                <button className="btn-secondary import-row__btn" onClick={() => void retryImport(item.id)}>
                  Retry
                </button>
              )}
              <button
                className="grocery-row__remove"
                onClick={() => void deleteImport(item.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="import__manual">
        …or{' '}
        <button className="addfood__link" onClick={() => setCaptionOpen(!captionOpen)}>
          paste an Instagram caption
        </button>{' '}
        ·{' '}
        <button className="addfood__link" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          enter a recipe manually
        </button>
      </p>
      {captionOpen && (
        <div className="import__caption">
          <textarea
            className="input-field import__caption-box"
            rows={8}
            placeholder="Paste the reel's caption here…"
            value={captionText}
            onChange={(e) => setCaptionText(e.target.value)}
            disabled={loading}
          />
          <button
            className="btn-primary"
            onClick={parseCaption}
            disabled={loading || !captionText.trim()}
          >
            Read recipe from caption
          </button>
        </div>
      )}
    </div>
  )
}
