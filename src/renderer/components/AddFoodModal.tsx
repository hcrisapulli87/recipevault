import { useRef, useState } from 'react'
import type { JSX } from 'react'
import type { FoodItem, MealType } from '../../shared/types'
import { MEAL_LABEL } from '../../shared/types'
import { searchStaples } from '../../shared/nutrition'
import { lookupBarcode, searchFoods, cacheFood } from '../data/foods'
import { addLogEntry } from '../data/tracker'
import type { NewLogEntry } from '../data/tracker'
import { BarcodeScanner } from './BarcodeScanner'

type Tab = 'search' | 'barcode' | 'manual'

const round1 = (n: number): number => Math.round(n * 10) / 10

function macroLine(item: FoodItem, factor = 1): string {
  return (
    `${Math.round(item.calories * factor)} kcal · ` +
    `P ${round1(item.protein * factor)} / C ${round1(item.carbs * factor)} / F ${round1(item.fat * factor)} g`
  )
}

/** Choose how much was eaten, preview the macros, then log it. */
function PortionStep(props: {
  item: FoodItem
  mealLabel: string
  busy: boolean
  error: string | null
  onBack: () => void
  onAdd: (amount: number) => void
  /** Set when the item came from the barcode cache — offers a fresh OFF fetch. */
  onRecheck?: (() => void) | null
  recheckBusy?: boolean
  recheckNote?: string | null
}): JSX.Element {
  const isGram = props.item.unit === '100g'
  const [value, setValue] = useState(isGram ? 100 : 1)
  const amount = isGram ? value / 100 : value

  return (
    <>
      <h3 className="modal__title">Add to {props.mealLabel}</h3>
      <div className="food-pick">
        <span className="food-pick__name">
          {props.item.name}
          {props.item.brand ? (
            <span className="food-pick__brand"> · {props.item.brand}</span>
          ) : null}
        </span>
        {props.item.servingDesc && (
          <span className="food-pick__serving">{props.item.servingDesc}</span>
        )}
      </div>

      <label className="field">
        <span className="field__label">{isGram ? 'Grams' : 'Servings'}</span>
        <input
          className="text-input"
          type="number"
          min="0"
          step={isGram ? 10 : 0.5}
          value={value}
          autoFocus
          onChange={(e) => setValue(Math.max(0, Number(e.target.value)))}
        />
      </label>

      <div className="banner banner--ok food-preview">{macroLine(props.item, amount)}</div>
      {props.onRecheck && (
        <div className="banner banner--warn">
          <span>Saved from an earlier scan — macros may be out of date.</span>
          <button className="btn" onClick={props.onRecheck} disabled={props.recheckBusy}>
            {props.recheckBusy ? 'Checking…' : '↻ Re-check OpenFoodFacts'}
          </button>
        </div>
      )}
      {props.recheckNote && <div className="banner banner--warn">{props.recheckNote}</div>}
      {props.error && <div className="banner banner--error">{props.error}</div>}

      <div className="modal__actions">
        <button className="btn" onClick={props.onBack} disabled={props.busy}>
          Back
        </button>
        <button
          className="btn btn--primary"
          onClick={() => props.onAdd(amount)}
          disabled={amount <= 0 || props.busy}
        >
          {props.busy ? 'Adding…' : 'Add'}
        </button>
      </div>
    </>
  )
}

export function AddFoodModal(props: {
  mealType: MealType
  date: string
  planned?: FoodItem | null
  onClose: () => void
  onLogged: () => void
}): JSX.Element {
  const mealLabel = MEAL_LABEL[props.mealType]
  const [tab, setTab] = useState<Tab>('search')
  const [selected, setSelected] = useState<FoodItem | null>(null)
  // True when `selected` came from the per-user food_cache (enables "re-check OFF").
  const [selectedFromCache, setSelectedFromCache] = useState(false)
  const [logging, setLogging] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)

  // search tab
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [searchOnline, setSearchOnline] = useState(true)

  // barcode tab
  const [scanning, setScanning] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [barcodeError, setBarcodeError] = useState<string | null>(null)
  // Set when a scan/lookup found no product — carried into the Manual tab so the
  // entry is saved into food_cache and the next scan of it resolves instantly.
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null)

  // manual tab
  const [mName, setMName] = useState('')
  const [mBrand, setMBrand] = useState('')
  const [mCal, setMCal] = useState('')
  const [mProtein, setMProtein] = useState('')
  const [mCarbs, setMCarbs] = useState('')
  const [mFat, setMFat] = useState('')

  // Guards against out-of-order responses: only the latest search may write
  // results (a slow earlier response must not overwrite a newer one).
  const searchSeqRef = useRef(0)

  /** Live-filter the bundled staples as the user types; the online search only
   *  runs on Enter/Search. Also invalidates any in-flight online search. */
  const onQueryChange = (value: string): void => {
    setQuery(value)
    searchSeqRef.current++
    setSearching(false)
    setSearched(false)
    setSearchError(null)
    setSearchOnline(true)
    setResults(searchStaples(value))
  }

  const runSearch = async (): Promise<void> => {
    if (!query.trim()) return
    const seq = ++searchSeqRef.current
    setSearching(true)
    setSearchError(null)
    try {
      const { items, online } = await searchFoods(query.trim())
      if (seq !== searchSeqRef.current) return // stale response — a newer search owns the UI
      setResults(items)
      setSearchOnline(online)
    } catch (err) {
      if (seq !== searchSeqRef.current) return
      setSearchError(err instanceof Error ? err.message : 'Search failed.')
    }
    setSearching(false)
    setSearched(true)
  }

  const lookUp = async (code: string): Promise<void> => {
    const trimmed = code.trim()
    if (!trimmed) return
    setScanning(false)
    setLookingUp(true)
    setBarcodeError(null)
    try {
      const { item, online, fromCache } = await lookupBarcode(trimmed)
      if (item) {
        setPendingBarcode(null)
        setSelectedFromCache(fromCache)
        setSelected(item)
      } else if (online) {
        setBarcodeError(`No product found for barcode ${trimmed}.`)
        setPendingBarcode(trimmed)
      } else {
        // Couldn't reach OpenFoodFacts — the product may well exist, so don't
        // offer to cache a manual entry under this barcode (it would shadow the
        // real product on every future scan).
        setBarcodeError(
          `Couldn't check barcode ${trimmed} — you appear to be offline. Try again, or log it via the Manual tab (it won't be saved for future scans).`
        )
        setPendingBarcode(null)
      }
    } catch (err) {
      setBarcodeError(err instanceof Error ? err.message : 'Lookup failed.')
    }
    setLookingUp(false)
  }

  // Re-fetch a cached barcode item straight from OFF (skipCache), replacing the
  // selected item — lookupBarcode re-caches the fresh result on success.
  const [rechecking, setRechecking] = useState(false)
  const [recheckNote, setRecheckNote] = useState<string | null>(null)
  const recheck = async (): Promise<void> => {
    if (!selected?.barcode || rechecking) return
    setRechecking(true)
    setRecheckNote(null)
    try {
      const { item, online } = await lookupBarcode(selected.barcode, { skipCache: true })
      if (item) {
        setSelected(item)
        setSelectedFromCache(false)
      } else if (online) {
        setRecheckNote("OpenFoodFacts doesn't know this barcode — keeping your saved version.")
      } else {
        setRecheckNote("Couldn't reach OpenFoodFacts — keeping your saved version.")
      }
    } catch {
      setRecheckNote("Couldn't reach OpenFoodFacts — keeping your saved version.")
    }
    setRechecking(false)
  }

  const startManual = (): void => {
    if (!mName.trim()) return
    setSelectedFromCache(false)
    setSelected({
      name: mName.trim(),
      brand: mBrand.trim() || null,
      barcode: pendingBarcode,
      servingDesc: null,
      unit: 'serving',
      calories: Number(mCal) || 0,
      protein: Number(mProtein) || 0,
      carbs: Number(mCarbs) || 0,
      fat: Number(mFat) || 0,
      source: 'manual'
    })
  }

  const log = async (amount: number): Promise<void> => {
    if (!selected || logging) return
    const entry: NewLogEntry = {
      date: props.date,
      mealType: props.mealType,
      name: selected.name,
      brand: selected.brand,
      amount,
      unit: selected.unit,
      baseCalories: selected.calories,
      baseProtein: selected.protein,
      baseCarbs: selected.carbs,
      baseFat: selected.fat,
      barcode: selected.barcode,
      source: selected.source
    }
    setLogging(true)
    setLogError(null)
    try {
      await addLogEntry(entry)
      if (selected.source === 'manual' && selected.barcode) {
        try {
          await cacheFood(selected)
        } catch {
          // cache is best-effort; the entry itself is already logged
        }
      }
      props.onLogged()
      props.onClose()
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Could not save — try again.')
      setLogging(false)
    }
  }

  if (selected) {
    return (
      <div className="modal-overlay" onClick={props.onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <PortionStep
            // Remount if a re-check swaps the item (its unit may flip serving↔100g,
            // which changes what the amount field means).
            key={`${selected.name}|${selected.unit}`}
            item={selected}
            mealLabel={mealLabel}
            busy={logging}
            error={logError}
            onRecheck={selectedFromCache && selected.barcode ? recheck : null}
            recheckBusy={rechecking}
            recheckNote={recheckNote}
            onBack={() => {
              setSelected(null)
              setSelectedFromCache(false)
              setLogError(null)
              setRecheckNote(null)
            }}
            onAdd={log}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal__title">Add food · {mealLabel}</h3>

        <div className="tabs">
          {(['search', 'barcode', 'manual'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`tabs__tab ${tab === t ? 'tabs__tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'search' ? '🔍 Search' : t === 'barcode' ? '📷 Barcode' : '✏️ Manual'}
            </button>
          ))}
        </div>

        {tab === 'search' && (
          <>
            {props.planned && (
              <button
                className="food-result food-result--planned"
                onClick={() => {
                  setSelectedFromCache(false)
                  setSelected(props.planned!)
                }}
              >
                <span className="food-result__name">📋 Planned: {props.planned.name}</span>
                <span className="food-result__macros">
                  {macroLine(props.planned)} — tap to log
                </span>
              </button>
            )}
            <div className="search-row">
              <input
                className="text-input"
                placeholder="Search foods (e.g. greek yogurt)…"
                value={query}
                autoFocus
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              />
              <button className="btn btn--primary" onClick={runSearch} disabled={searching}>
                {searching ? '…' : 'Search'}
              </button>
            </div>
            {searchError && <div className="banner banner--error">{searchError}</div>}
            {searched && !searching && !searchOnline && (
              <div className="banner banner--warn">
                Online food search is unavailable right now — only the offline staples list was
                searched.
              </div>
            )}
            <ul className="food-results">
              {results.map((item, i) => (
                <li key={i}>
                  <button
                    className="food-result"
                    onClick={() => {
                      setSelectedFromCache(false)
                      setSelected(item)
                    }}
                  >
                    <span className="food-result__name">
                      {item.source === 'staple' && <span className="food-result__tag">staple</span>}
                      {item.name}
                      {item.brand ? (
                        <span className="food-result__brand"> · {item.brand}</span>
                      ) : null}
                    </span>
                    <span className="food-result__macros">
                      {macroLine(item)}
                      {item.servingDesc ? ` — ${item.servingDesc}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!searched && !searching && query.trim() !== '' && (
              <p className="empty-note">
                {results.length > 0 ? 'Offline staples shown — press' : 'Press'} Enter or Search
                for online products.
              </p>
            )}
            {searched && !searching && results.length === 0 && !searchError && searchOnline && (
              <p className="empty-note">No matches. Try the Manual tab.</p>
            )}
          </>
        )}

        {tab === 'barcode' && (
          <>
            {scanning ? (
              <>
                <BarcodeScanner onDetected={(code) => lookUp(code)} />
                <button className="btn" onClick={() => setScanning(false)}>
                  Stop camera
                </button>
              </>
            ) : (
              <button className="btn btn--primary" onClick={() => setScanning(true)}>
                📷 Scan with camera
              </button>
            )}
            <p className="modal__hint">…or type the barcode number:</p>
            <div className="search-row">
              <input
                className="text-input"
                placeholder="e.g. 5000159407236"
                value={barcodeInput}
                inputMode="numeric"
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && lookUp(barcodeInput)}
              />
              <button
                className="btn btn--primary"
                onClick={() => lookUp(barcodeInput)}
                disabled={lookingUp}
              >
                {lookingUp ? '…' : 'Look up'}
              </button>
            </div>
            {barcodeError && (
              <div className="banner banner--warn">
                <span>{barcodeError}</span>
                {pendingBarcode && (
                  <button className="btn" onClick={() => setTab('manual')}>
                    ✏️ Add it manually — saves for next scan
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'manual' && (
          <>
            {pendingBarcode && (
              <div className="banner banner--ok">
                <span>
                  Will be saved for barcode <strong>{pendingBarcode}</strong> — next scan is
                  instant.
                </span>
                <button className="btn" onClick={() => setPendingBarcode(null)}>
                  Detach
                </button>
              </div>
            )}
            <label className="field">
              <span className="field__label">Food name</span>
              <input
                className="text-input"
                value={mName}
                autoFocus
                onChange={(e) => setMName(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Brand (optional)</span>
              <input
                className="text-input"
                value={mBrand}
                onChange={(e) => setMBrand(e.target.value)}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field__label">Calories</span>
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  value={mCal}
                  onChange={(e) => setMCal(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">Protein (g)</span>
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  value={mProtein}
                  onChange={(e) => setMProtein(e.target.value)}
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span className="field__label">Carbs (g)</span>
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  value={mCarbs}
                  onChange={(e) => setMCarbs(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">Fat (g)</span>
                <input
                  className="text-input"
                  type="number"
                  min="0"
                  value={mFat}
                  onChange={(e) => setMFat(e.target.value)}
                />
              </label>
            </div>
            <div className="modal__actions">
              <button className="btn" onClick={props.onClose}>
                Cancel
              </button>
              <button className="btn btn--primary" onClick={startManual} disabled={!mName.trim()}>
                Continue
              </button>
            </div>
          </>
        )}

        {tab !== 'manual' && (
          <div className="modal__actions">
            <button className="btn" onClick={props.onClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
