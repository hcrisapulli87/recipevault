import { useState } from 'react'
import type { JSX } from 'react'
import type { FoodItem, MealType } from '../../shared/types'
import { MEAL_LABEL } from '../../shared/types'
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
  onClose: () => void
  onLogged: () => void
}): JSX.Element {
  const mealLabel = MEAL_LABEL[props.mealType]
  const [tab, setTab] = useState<Tab>('search')
  const [selected, setSelected] = useState<FoodItem | null>(null)
  const [logging, setLogging] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)

  // search tab
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

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

  const runSearch = async (): Promise<void> => {
    if (!query.trim()) return
    setSearching(true)
    setSearchError(null)
    try {
      setResults(await searchFoods(query.trim()))
    } catch (err) {
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
      const item = await lookupBarcode(trimmed)
      if (!item) {
        setBarcodeError(`No product found for barcode ${trimmed}.`)
        setPendingBarcode(trimmed)
      } else {
        setPendingBarcode(null)
        setSelected(item)
      }
    } catch (err) {
      setBarcodeError(err instanceof Error ? err.message : 'Lookup failed.')
    }
    setLookingUp(false)
  }

  const startManual = (): void => {
    if (!mName.trim()) return
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
            item={selected}
            mealLabel={mealLabel}
            busy={logging}
            error={logError}
            onBack={() => {
              setSelected(null)
              setLogError(null)
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
            <div className="search-row">
              <input
                className="text-input"
                placeholder="Search foods (e.g. greek yogurt)…"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              />
              <button className="btn btn--primary" onClick={runSearch} disabled={searching}>
                {searching ? '…' : 'Search'}
              </button>
            </div>
            {searchError && <div className="banner banner--error">{searchError}</div>}
            <ul className="food-results">
              {results.map((item, i) => (
                <li key={i}>
                  <button className="food-result" onClick={() => setSelected(item)}>
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
            {searched && !searching && results.length === 0 && !searchError && (
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
