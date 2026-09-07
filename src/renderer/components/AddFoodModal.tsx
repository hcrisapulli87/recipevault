import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { FoodItem, MealType } from '../../shared/types'
import { MEAL_LABEL, MEAL_TYPES } from '../../shared/types'
import { searchStaples } from '../../shared/nutrition'
import { lookupBarcode, searchFoods, cacheFood, getRecentFoods } from '../data/foods'
import { addLogEntry } from '../data/tracker'
import type { NewLogEntry } from '../data/tracker'
import { BarcodeScanner } from './BarcodeScanner'
import { BottomSheet } from './BottomSheet'
import { useToast } from './Toast'

type Tab = 'search' | 'scan' | 'manual'

const round1 = (n: number): number => Math.round(n * 10) / 10
const fmtG = (n: number): string => {
  const v = round1(n)
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1)
}

function foodSub(item: FoodItem): string {
  return [item.brand, item.servingDesc].filter(Boolean).join(' · ')
}

/** What the row's kcal figure is actually per. Generics are per 100 g and branded
 *  products are usually per serve, so the bare number in the column was comparing two
 *  different things — 11 for a 5 g scrape of Vegemite sat next to 260 for 100 g of bread. */
function kcalBasis(item: FoodItem): string {
  return item.unit === '100g' ? '/100g' : '/serve'
}

/** A stable identity for a food row — index keys reorder wrongly as results change. */
function foodKey(item: FoodItem): string {
  return item.barcode ?? `${item.name}|${item.brand ?? ''}`
}

/** What actually gets logged: the day view multiplies base_* × amount. */
export interface LogBasis {
  unit: string
  baseCalories: number
  baseProtein: number
  baseCarbs: number
  baseFat: number
  amount: number
}

/** Per-100 g basis for an item, when one can be established (enables grams⇄serving). */
function per100gOf(item: FoodItem): { calories: number; protein: number; carbs: number; fat: number } | null {
  if (item.per100g) return item.per100g
  if (item.unit === '100g') {
    return { calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat }
  }
  return null
}

/** One tappable food row: name + brand·serve meta, kcal right-aligned. */
function FoodRow(props: { item: FoodItem; onPick: () => void; note?: string }): JSX.Element {
  return (
    <button className="food-row" onClick={props.onPick}>
      <span className="food-row__main">
        <span className="food-row__name">{props.item.name}</span>
        <span className="food-row__sub">{props.note ?? foodSub(props.item)}</span>
      </span>
      <span className="food-row__kcal">
        {Math.round(props.item.calories)}
        <span className="food-row__basis">{kcalBasis(props.item)}</span>
      </span>
    </button>
  )
}

/** Confirm step: meal segmented, flexible grams⇄serving amount, live macro tiles, Add. */
function ConfirmStep(props: {
  item: FoodItem
  meal: MealType
  onMeal: (m: MealType) => void
  busy: boolean
  error: string | null
  onBack: () => void
  onAdd: (basis: LogBasis) => void
  /** Set when the item came from the barcode cache — offers a fresh OFF fetch. */
  onRecheck?: (() => void) | null
  recheckBusy?: boolean
  recheckNote?: string | null
}): JSX.Element {
  const p100 = per100gOf(props.item)
  const measures = props.item.measures ?? []
  // Flexible when we have a per-100 g basis: the user can log by grams OR by any
  // known serving. Without a basis (legacy cache/manual serving items) we keep the
  // old per-serving stepper.
  const flexible = p100 !== null

  // Flexible state: grams is the single source of truth; serving mode drives it
  // through a chosen measure × count.
  const [mode, setMode] = useState<'g' | 'serving'>(measures.length ? 'serving' : 'g')
  const [grams, setGrams] = useState<number>(measures[0]?.grams ?? 100)
  const [measureIdx, setMeasureIdx] = useState(0)
  const [count, setCount] = useState(1)

  // Legacy state: serves (or grams for a bare 100 g item with no basis — unreachable
  // here since 100 g always yields a basis, but kept for safety).
  const legacyIsGram = props.item.unit === '100g'
  const [legacyValue, setLegacyValue] = useState(legacyIsGram ? 100 : 1)

  const pickMeasure = (i: number): void => {
    setMeasureIdx(i)
    setCount(1)
    setGrams(measures[i].grams)
  }
  const stepServing = (delta: number): void => {
    const c = Math.max(0.5, round1(count + delta))
    setCount(c)
    setGrams(round1(measures[measureIdx].grams * c))
  }

  // Resolve the effective macros + the basis to log.
  let macros: { calories: number; protein: number; carbs: number; fat: number }
  let basis: LogBasis
  let amountValid: boolean
  if (flexible && p100) {
    const g = mode === 'g' ? grams : round1(measures[measureIdx].grams * count)
    const f = g / 100
    macros = {
      calories: p100.calories * f,
      protein: p100.protein * f,
      carbs: p100.carbs * f,
      fat: p100.fat * f
    }
    // Stored canonically as 100 g so history + edit steppers work unchanged.
    basis = {
      unit: '100g',
      baseCalories: p100.calories,
      baseProtein: p100.protein,
      baseCarbs: p100.carbs,
      baseFat: p100.fat,
      amount: g / 100
    }
    amountValid = g > 0
  } else {
    const factor = legacyIsGram ? legacyValue / 100 : legacyValue
    macros = {
      calories: props.item.calories * factor,
      protein: props.item.protein * factor,
      carbs: props.item.carbs * factor,
      fat: props.item.fat * factor
    }
    basis = {
      unit: props.item.unit,
      baseCalories: props.item.calories,
      baseProtein: props.item.protein,
      baseCarbs: props.item.carbs,
      baseFat: props.item.fat,
      amount: factor
    }
    amountValid = factor > 0
  }

  return (
    <div className="confirm">
      <button className="btn-ghost confirm__back" onClick={props.onBack} disabled={props.busy}>
        ← Back to search
      </button>
      <div className="confirm__food">
        <div className="confirm__name">{props.item.name}</div>
        <div className="confirm__meta">{foodSub(props.item) || 'per 100 g'}</div>
      </div>

      <div className="eyebrow confirm__eyebrow">Meal</div>
      <div className="seg">
        {MEAL_TYPES.map((m) => (
          <button
            key={m}
            className={`seg__btn seg__btn--small ${props.meal === m ? 'seg__btn--active' : ''}`}
            onClick={() => props.onMeal(m)}
          >
            {MEAL_LABEL[m].toUpperCase()}
          </button>
        ))}
      </div>

      <div className="eyebrow confirm__eyebrow">Amount</div>

      {flexible ? (
        <>
          {measures.length > 0 && (
            <div className="seg confirm__mode">
              <button
                className={`seg__btn seg__btn--small ${mode === 'serving' ? 'seg__btn--active' : ''}`}
                onClick={() => setMode('serving')}
              >
                SERVING
              </button>
              <button
                className={`seg__btn seg__btn--small ${mode === 'g' ? 'seg__btn--active' : ''}`}
                onClick={() => setMode('g')}
              >
                GRAMS
              </button>
            </div>
          )}

          {mode === 'serving' && measures.length > 0 ? (
            <>
              {measures.length > 1 && (
                <div className="confirm__chips">
                  {measures.map((m, i) => (
                    <button
                      key={i}
                      className={`chip ${i === measureIdx ? 'chip--active' : ''}`}
                      onClick={() => pickMeasure(i)}
                    >
                      {m.desc} · {Math.round(m.grams)} g
                    </button>
                  ))}
                </div>
              )}
              <div className="confirm__amount">
                <button className="round-btn confirm__step" aria-label="Less" onClick={() => stepServing(-0.5)}>
                  −
                </button>
                <span className="confirm__amount-label">
                  {count % 1 === 0 ? count : count.toFixed(1)} × {measures[measureIdx].desc}
                </span>
                <button className="round-btn confirm__step" aria-label="More" onClick={() => stepServing(0.5)}>
                  +
                </button>
              </div>
              <div className="confirm__serve-note">
                = {Math.round(measures[measureIdx].grams * count)} g
              </div>
            </>
          ) : (
            <>
              <div className="confirm__amount">
                <button
                  className="round-btn confirm__step"
                  aria-label="Less"
                  onClick={() => setGrams(Math.max(10, round1(grams - 10)))}
                >
                  −
                </button>
                <span className="confirm__amount-label">{Math.round(grams)} g</span>
                <button
                  className="round-btn confirm__step"
                  aria-label="More"
                  onClick={() => setGrams(round1(grams + 10))}
                >
                  +
                </button>
              </div>
              {measures.length === 0 && (
                <div className="confirm__serve-note">No serving size on record — log by weight.</div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="confirm__amount">
            <button
              className="round-btn confirm__step"
              aria-label="Less"
              onClick={() =>
                setLegacyValue(Math.max(legacyIsGram ? 10 : 0.5, round1(legacyValue - (legacyIsGram ? 10 : 0.5))))
              }
            >
              −
            </button>
            <span className="confirm__amount-label">
              {legacyIsGram
                ? `${Math.round(legacyValue)} g`
                : `${legacyValue % 1 === 0 ? legacyValue : legacyValue.toFixed(1)} serve${legacyValue === 1 ? '' : 's'}`}
            </span>
            <button
              className="round-btn confirm__step"
              aria-label="More"
              onClick={() => setLegacyValue(round1(legacyValue + (legacyIsGram ? 10 : 0.5)))}
            >
              +
            </button>
          </div>
          {props.item.servingDesc && !legacyIsGram && (
            <div className="confirm__serve-note">1 serve = {props.item.servingDesc}</div>
          )}
        </>
      )}

      <div className="confirm__tiles">
        {(
          [
            ['KCAL', Math.round(macros.calories).toLocaleString()],
            ['P', fmtG(macros.protein)],
            ['C', fmtG(macros.carbs)],
            ['F', fmtG(macros.fat)]
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="confirm__tile">
            <div className="confirm__tile-label">{label}</div>
            <div className="confirm__tile-value">{v}</div>
          </div>
        ))}
      </div>
      <div className="confirm__caption">
        Best-guess from the database — close enough is the point.
      </div>

      {props.onRecheck && (
        <div className="info-banner">
          <span>Saved from an earlier scan — macros may be out of date.</span>
          <button className="btn-secondary" onClick={props.onRecheck} disabled={props.recheckBusy}>
            {props.recheckBusy ? 'Checking…' : '↻ Re-check OpenFoodFacts'}
          </button>
        </div>
      )}
      {props.recheckNote && <div className="info-banner">{props.recheckNote}</div>}
      {props.error && <div className="info-banner info-banner--warm">{props.error}</div>}

      <button
        className="btn-primary confirm__add"
        onClick={() => props.onAdd(basis)}
        disabled={!amountValid || props.busy}
      >
        {props.busy ? 'Adding…' : `Add to ${MEAL_LABEL[props.meal]}`}
      </button>
    </div>
  )
}

export function AddFoodModal(props: {
  mealType: MealType
  date: string
  planned?: FoodItem | null
  onClose: () => void
  onLogged: () => void
}): JSX.Element {
  const toast = useToast()
  const [meal, setMeal] = useState<MealType>(props.mealType)
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
  // Recently logged foods (own entries), shown before a query is typed —
  // everyday items are one tap instead of a network search. Best-effort.
  const [recents, setRecents] = useState<FoodItem[]>([])
  useEffect(() => {
    getRecentFoods().then(setRecents, () => {})
  }, [])

  // scan tab — the camera starts as soon as the tab opens (see switchTab)
  const [scanning, setScanning] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [lookingUp, setLookingUp] = useState(false)
  const [barcodeError, setBarcodeError] = useState<string | null>(null)
  // Set when a scan/lookup found no product — carried into the Manual tab so the
  // entry is saved into food_cache and the next scan of it resolves instantly.
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null)

  const switchTab = (t: Tab): void => {
    setTab(t)
    setScanning(t === 'scan')
  }

  // manual tab
  const [mName, setMName] = useState('')
  const [mBrand, setMBrand] = useState('')
  const [mServeG, setMServeG] = useState('')
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

  // Retail barcodes (EAN-8 → GTIN-14) are 8–14 digits; anything else would be a
  // guaranteed-miss OFF call ending in a confusing "no product found".
  const isValidBarcode = (code: string): boolean => /^\d{8,14}$/.test(code)

  const lookUp = async (code: string): Promise<void> => {
    const trimmed = code.trim()
    // Stop the viewfinder FIRST. The scanner has already latched onto its read and
    // killed the camera stream by the time it calls back, so bailing out before this
    // left a frozen preview with no message and no way forward.
    setScanning(false)
    if (!isValidBarcode(trimmed)) {
      // Empty is just an accidental Enter in the typed field — say nothing.
      if (trimmed !== '') {
        setBarcodeError(
          `Read "${trimmed}", which isn't a retail barcode (8–14 digits). Try again, or type it below.`
        )
      }
      return
    }
    setLookingUp(true)
    setBarcodeError(null)
    try {
      const { item, online, fromCache } = await lookupBarcode(trimmed)
      if (item) {
        setPendingBarcode(null)
        setSelectedFromCache(fromCache)
        setSelected(item)
        toast(`Barcode matched: ${item.name}`)
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

  // A name alone used to be enough to Continue, which logged a silent 0 kcal entry that
  // then sat in the day's total contributing nothing. The kcal field must be FILLED, not
  // non-zero — black coffee and diet drinks are honestly 0.
  const manualReady = mName.trim() !== '' && mCal.trim() !== ''

  const startManual = (): void => {
    if (!manualReady) return
    setSelectedFromCache(false)
    const serveG = Number(mServeG)
    const cal = Number(mCal) || 0
    const protein = Number(mProtein) || 0
    const carbs = Number(mCarbs) || 0
    const fat = Number(mFat) || 0
    // With a serving weight we can express a per-100 g basis, unlocking the
    // grams⇄serving picker; without one it's a per-serve-only entry.
    const hasServe = serveG > 0
    const to100 = (v: number): number => (v * 100) / serveG
    setSelected({
      name: mName.trim(),
      brand: mBrand.trim() || null,
      barcode: pendingBarcode,
      servingDesc: hasServe ? `${serveG} g` : null,
      unit: 'serving',
      calories: cal,
      protein,
      carbs,
      fat,
      source: 'manual',
      per100g: hasServe
        ? { calories: to100(cal), protein: to100(protein), carbs: to100(carbs), fat: to100(fat) }
        : undefined,
      measures: hasServe ? [{ desc: '1 serve', grams: serveG }] : []
    })
  }

  const log = async (basis: LogBasis): Promise<void> => {
    if (!selected || logging) return
    const entry: NewLogEntry = {
      date: props.date,
      mealType: meal,
      name: selected.name,
      brand: selected.brand,
      amount: basis.amount,
      unit: basis.unit,
      baseCalories: basis.baseCalories,
      baseProtein: basis.baseProtein,
      baseCarbs: basis.baseCarbs,
      baseFat: basis.baseFat,
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
      toast(`Added to ${MEAL_LABEL[meal]}`)
      props.onLogged()
      props.onClose()
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Could not save — try again.')
      setLogging(false)
    }
  }

  const pick = (item: FoodItem, fromCache = false): void => {
    setSelectedFromCache(fromCache)
    setSelected(item)
  }

  return (
    <BottomSheet title="Add food" tall onClose={props.onClose}>
      {selected ? (
        <ConfirmStep
          // Remount if a re-check swaps the item (its unit may flip serving↔100g,
          // which changes what the amount field means).
          key={`${selected.name}|${selected.unit}`}
          item={selected}
          meal={meal}
          onMeal={setMeal}
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
      ) : (
        <div className="addfood">
          <div className="seg addfood__tabs">
            {(['search', 'scan', 'manual'] as Tab[]).map((t) => (
              <button
                key={t}
                className={`seg__btn ${tab === t ? 'seg__btn--active' : ''}`}
                onClick={() => switchTab(t)}
              >
                {t === 'search' ? 'Search' : t === 'scan' ? 'Scan' : 'Manual'}
              </button>
            ))}
          </div>

          {tab === 'search' && (
            <div className="addfood__pane">
              <input
                className="input-pill"
                placeholder="Search foods (AU database)"
                value={query}
                autoFocus
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              />

              {props.planned && query.trim() === '' && (
                <button className="planned-row" onClick={() => pick(props.planned!)}>
                  <span className="food-row__main">
                    <span className="food-row__name">Planned: {props.planned.name}</span>
                    <span className="food-row__sub">{props.planned.servingDesc}</span>
                  </span>
                  <span className="food-row__kcal">
                    {Math.round(props.planned.calories)}
                    <span className="food-row__basis">{kcalBasis(props.planned)}</span>
                  </span>
                </button>
              )}

              {query.trim() === '' && recents.length > 0 && (
                <>
                  <div className="addfood__head eyebrow">Recents</div>
                  {recents.map((item) => (
                    <FoodRow key={foodKey(item)} item={item} onPick={() => pick(item)} />
                  ))}
                </>
              )}

              {query.trim() !== '' && (
                <>
                  <div className="addfood__head eyebrow">Results</div>
                  {results.map((item) => (
                    <FoodRow key={foodKey(item)} item={item} onPick={() => pick(item)} />
                  ))}
                  {!searched && !searching && (
                    <p className="addfood__note">
                      {results.length > 0 ? 'Offline staples shown — press' : 'Press'} Enter to
                      search online products.
                    </p>
                  )}
                  {searching && <p className="addfood__note">Searching…</p>}
                  {searched &&
                    !searching &&
                    results.length === 0 &&
                    !searchError &&
                    searchOnline && (
                      <p className="addfood__note">
                        No match. Try the barcode scanner or{' '}
                        <button className="addfood__link" onClick={() => switchTab('manual')}>
                          enter it manually
                        </button>
                        .
                      </p>
                    )}
                </>
              )}

              {searchError && <div className="info-banner info-banner--warm">{searchError}</div>}
              {searched && !searching && !searchOnline && (
                <div className="info-banner">
                  Online food search is unavailable right now — only the offline staples list was
                  searched.
                </div>
              )}

              <p className="addfood__caption">
                Generic foods: Australian Food Composition Database (FSANZ, CC BY) · branded from Open
                Food Facts · values are estimates
              </p>
            </div>
          )}

          {tab === 'scan' && (
            <div className="addfood__pane">
              {scanning ? (
                <BarcodeScanner onDetected={(code) => lookUp(code)} />
              ) : (
                <button className="btn-secondary" onClick={() => setScanning(true)}>
                  Restart camera
                </button>
              )}
              {lookingUp && <p className="addfood__note">Looking it up…</p>}
              {barcodeError && (
                <div className="info-banner info-banner--warm">
                  <span>{barcodeError}</span>
                  <span className="info-banner__actions">
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setBarcodeError(null)
                        setScanning(true)
                      }}
                    >
                      Scan again
                    </button>
                    {pendingBarcode && (
                      <button className="btn-secondary" onClick={() => switchTab('manual')}>
                        Add it manually — saves for next scan
                      </button>
                    )}
                  </span>
                </div>
              )}
              <div className="addfood__barcode-row">
                <input
                  className="input-pill"
                  placeholder="…or type the barcode"
                  value={barcodeInput}
                  inputMode="numeric"
                  onChange={(e) => setBarcodeInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && lookUp(barcodeInput)}
                />
                <button
                  className="btn-secondary"
                  onClick={() => lookUp(barcodeInput)}
                  disabled={lookingUp || !isValidBarcode(barcodeInput.trim())}
                >
                  {lookingUp ? '…' : 'Look up'}
                </button>
              </div>
              {barcodeInput !== '' && !isValidBarcode(barcodeInput.trim()) && (
                <p className="addfood__note">Barcodes are 8–14 digits.</p>
              )}
            </div>
          )}

          {tab === 'manual' && (
            <div className="addfood__pane">
              {pendingBarcode && (
                <div className="info-banner">
                  <span>
                    Barcode not in the database yet — save it once and it&rsquo;s cached for next
                    time ({pendingBarcode}).
                  </span>
                  <button className="btn-secondary" onClick={() => setPendingBarcode(null)}>
                    Detach
                  </button>
                </div>
              )}
              <label className="ffield">
                <span className="ffield__label">Food name</span>
                <input
                  className="input-field"
                  value={mName}
                  placeholder="e.g. Protein bar"
                  autoFocus
                  onChange={(e) => setMName(e.target.value)}
                />
              </label>
              <label className="ffield">
                <span className="ffield__label">Brand (optional)</span>
                <input
                  className="input-field"
                  value={mBrand}
                  onChange={(e) => setMBrand(e.target.value)}
                />
              </label>
              <div className="ffield-grid">
                <label className="ffield">
                  <span className="ffield__label">Serving size (g)</span>
                  <input
                    className="input-field"
                    type="number"
                    min="0"
                    value={mServeG}
                    onChange={(e) => setMServeG(e.target.value)}
                  />
                </label>
                <label className="ffield">
                  <span className="ffield__label">kcal / serve</span>
                  <input
                    className="input-field"
                    type="number"
                    min="0"
                    value={mCal}
                    onChange={(e) => setMCal(e.target.value)}
                  />
                </label>
                <label className="ffield">
                  <span className="ffield__label">Protein (g)</span>
                  <input
                    className="input-field"
                    type="number"
                    min="0"
                    value={mProtein}
                    onChange={(e) => setMProtein(e.target.value)}
                  />
                </label>
                <label className="ffield">
                  <span className="ffield__label">Carbs (g)</span>
                  <input
                    className="input-field"
                    type="number"
                    min="0"
                    value={mCarbs}
                    onChange={(e) => setMCarbs(e.target.value)}
                  />
                </label>
                <label className="ffield">
                  <span className="ffield__label">Fat (g)</span>
                  <input
                    className="input-field"
                    type="number"
                    min="0"
                    value={mFat}
                    onChange={(e) => setMFat(e.target.value)}
                  />
                </label>
              </div>
              {mName.trim() !== '' && mCal.trim() === '' && (
                <p className="addfood__note">Add the kcal per serve to continue.</p>
              )}
              <button
                className="btn-primary addfood__continue"
                onClick={startManual}
                disabled={!manualReady}
              >
                Continue
              </button>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  )
}
