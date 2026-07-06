// US → AU (metric) unit conversion for imported recipes.
// Converts what's EXACT (oz/lb weights, °F temps) and leaves what's cultural
// (cups/tbsp/tsp — used in Australian kitchens; grams would need densities).

const FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅕': 0.2,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875
}

// One quantity token: "1 1/2", "1/2", "1.5", "2", "½", "1½"
const QTY = String.raw`(?:\d+\s*[½⅓⅔¼¾⅕⅛⅜⅝⅞]|\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d*\.?\d+|[½⅓⅔¼¾⅕⅛⅜⅝⅞])`
// Optionally a range of two tokens, then an imperial weight unit as its own word.
const WEIGHT_RE = new RegExp(
  String.raw`(${QTY})(\s*[-–]\s*(${QTY}))?\s*(oz|ounces?|lbs?|pounds?)\b`,
  'gi'
)
const TEMP_RE = /(\d{2,3})\s*(?:°\s*|degrees?\s+)?F\b\.?/gi

function qtyValue(token: string): number {
  const t = token.trim()
  let m = t.match(/^(\d+)\s*([½⅓⅔¼¾⅕⅛⅜⅝⅞])$/)
  if (m) return Number(m[1]) + FRACTIONS[m[2]]
  if (FRACTIONS[t] !== undefined) return FRACTIONS[t]
  m = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3])
  m = t.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (m) return Number(m[1]) / Number(m[2])
  return Number(t)
}

/** Cookbook-style rounding: nearest 5 g under 250 g, nearest 10 g above (1 lb → 450 g). */
function roundGrams(g: number): number {
  return g < 250 ? Math.round(g / 5) * 5 : Math.round(g / 10) * 10
}

function toGrams(qty: number, unit: string): number {
  const perUnit = /^(oz|ounce|ounces)$/i.test(unit) ? 28.35 : 453.6
  return roundGrams(qty * perUnit)
}

/** Convert imperial weights in one ingredient line. */
export function metricizeLine(raw: string): { text: string; changed: boolean } {
  let changed = false
  const text = raw.replace(WEIGHT_RE, (_all, q1: string, _range, q2: string, unit: string) => {
    changed = true
    const lo = toGrams(qtyValue(q1), unit)
    if (q2) return `${lo}–${toGrams(qtyValue(q2), unit)} g`
    return `${lo} g`
  })
  return { text, changed }
}

/** Convert °F occurrences in free text (steps); returns how many were converted. */
export function metricizeText(text: string): { text: string; changed: number } {
  let changed = 0
  const out = text.replace(TEMP_RE, (all, f: string) => {
    changed++
    const c = Math.round(((Number(f) - 32) * 5) / 9 / 5) * 5
    return `${c}°C${all.endsWith('.') ? '.' : ''}`
  })
  return { text: out, changed }
}

interface Convertible {
  ingredients: { raw: string }[]
  steps: { text: string }[]
}

/** Anything worth converting in this recipe/draft? (drives the detail-page button) */
export function hasImperialUnits(r: Convertible): boolean {
  WEIGHT_RE.lastIndex = 0
  TEMP_RE.lastIndex = 0
  return (
    r.ingredients.some((i) => {
      WEIGHT_RE.lastIndex = 0
      return WEIGHT_RE.test(i.raw)
    }) ||
    r.steps.some((s) => {
      TEMP_RE.lastIndex = 0
      return TEMP_RE.test(s.text)
    })
  )
}

/** Convert a whole draft; counts let the review form say what happened. */
export function convertDraftToMetric<T extends Convertible>(
  draft: T
): { draft: T; measurements: number; temps: number } {
  let measurements = 0
  let temps = 0
  const ingredients = draft.ingredients.map((i) => {
    const r = metricizeLine(i.raw)
    if (r.changed) measurements++
    return { ...i, raw: r.text }
  })
  const steps = draft.steps.map((s) => {
    const r = metricizeText(s.text)
    temps += r.changed
    return { ...s, text: r.text }
  })
  return { draft: { ...draft, ingredients, steps }, measurements, temps }
}
