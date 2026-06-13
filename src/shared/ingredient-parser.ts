import type { ParsedIngredient } from './types'

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

// canonical singular unit ← accepted variants
const UNITS: Record<string, string[]> = {
  g: ['g', 'gram', 'grams'],
  kg: ['kg'],
  ml: ['ml'],
  l: ['l', 'litre', 'litres', 'liter', 'liters'],
  tsp: ['tsp', 'teaspoon', 'teaspoons'],
  tbsp: ['tbsp', 'tablespoon', 'tablespoons'],
  cup: ['cup', 'cups'],
  oz: ['oz', 'ounce', 'ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  clove: ['clove', 'cloves'],
  can: ['can', 'cans'],
  tin: ['tin', 'tins'],
  slice: ['slice', 'slices'],
  pinch: ['pinch', 'pinches'],
  handful: ['handful', 'handfuls'],
  bunch: ['bunch', 'bunches'],
  sprig: ['sprig', 'sprigs'],
  stick: ['stick', 'sticks'],
  knob: ['knob', 'knobs']
}
const UNIT_LOOKUP = new Map<string, string>(
  Object.entries(UNITS).flatMap(([canonical, variants]) =>
    variants.map((v) => [v, canonical] as [string, string])
  )
)

function readNumber(s: string): { value: number; rest: string } | null {
  // mixed number: "1 ½" or "1½"
  let m = s.match(/^(\d+)\s*([½⅓⅔¼¾⅕⅛⅜⅝⅞])\s*/)
  if (m) return { value: Number(m[1]) + FRACTIONS[m[2]], rest: s.slice(m[0].length) }
  // bare fraction: "½"
  m = s.match(/^([½⅓⅔¼¾⅕⅛⅜⅝⅞])\s*/)
  if (m) return { value: FRACTIONS[m[1]], rest: s.slice(m[0].length) }
  // decimal/integer, allowing "400g" (no space before unit)
  m = s.match(/^(\d+(?:\.\d+)?)(?:\s*)/)
  if (m) return { value: Number(m[1]), rest: s.slice(m[0].length) }
  return null
}

export function parseIngredient(raw: string): ParsedIngredient {
  const base: ParsedIngredient = {
    raw,
    quantity: null,
    quantityMax: null,
    unit: null,
    name: raw.trim()
  }
  let s = raw.trim()

  const first = readNumber(s)
  if (!first) return base
  s = first.rest

  // range: "1-2", "1–2", "1 to 2" — only commit if a second number follows
  let quantityMax: number | null = null
  const rangeSep = s.match(/^(?:-|–|to\s)\s*/)
  if (rangeSep) {
    const second = readNumber(s.slice(rangeSep[0].length))
    if (second) {
      quantityMax = second.value
      s = second.rest
    }
  }

  const unitMatch = s.match(/^([a-zA-Z]+)\.?(?:\s+|$)/)
  let unit: string | null = null
  if (unitMatch && UNIT_LOOKUP.has(unitMatch[1].toLowerCase())) {
    unit = UNIT_LOOKUP.get(unitMatch[1].toLowerCase())!
    s = s.slice(unitMatch[0].length)
  }

  const name = s.replace(/^of\s+/i, '').trim()
  return { raw, quantity: first.value, quantityMax, unit, name: name || base.name }
}

export function scaleIngredient(ing: ParsedIngredient, factor: number): ParsedIngredient {
  if (ing.quantity === null) return ing
  return {
    ...ing,
    quantity: ing.quantity * factor,
    quantityMax: ing.quantityMax === null ? null : ing.quantityMax * factor
  }
}

const NICE_FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [3 / 8, '⅜'],
  [1 / 2, '½'],
  [5 / 8, '⅝'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞']
]

export function formatQuantity(n: number): string {
  const whole = Math.floor(n)
  const frac = n - whole
  if (frac < 0.02) return String(whole)
  const nearest = NICE_FRACTIONS.reduce((a, b) =>
    Math.abs(b[0] - frac) < Math.abs(a[0] - frac) ? b : a
  )
  if (Math.abs(nearest[0] - frac) > 0.02) return String(Math.round(n * 100) / 100)
  return whole === 0 ? nearest[1] : `${whole} ${nearest[1]}`
}
