import { MEAL_TYPES } from './types'
import type { FoodItem, FoodMeasure, MealType } from './types'

// What you've logged before, folded into one entry per food. It powers the fast paths in
// Add Food — the serving you usually have, the foods you usually eat at this meal, and
// your own foods first in search — from data the log already holds, so there is nothing
// to keep up by hand.

/** One food_log row as history reads it (newest first is NOT assumed). */
export interface HistoryRow {
  id: number
  date: string
  mealType: MealType
  name: string
  brand: string | null
  barcode: string | null
  unit: string
  amount: number
  baseCalories: number
  baseProtein: number
  baseCarbs: number
  baseFat: number
  baseFibre: number | null
  source: string
}

export interface HistoryFood {
  key: string
  /** Ready to log again — per-100 g basis restored for 100 g entries. */
  item: FoodItem
  count: number
  countByMeal: Record<MealType, number>
  /** The most recent logging of it: what "remember my serving" brings back. */
  last: { unit: string; amount: number; date: string }
}

/** One identity per food: the barcode when there is one (globally unique), otherwise
 *  name + brand. The same key is used for favourites and search de-duplication. */
export function foodKey(f: { name: string; brand: string | null; barcode: string | null }): string {
  return f.barcode ? `bc:${f.barcode}` : `${f.name.toLowerCase()}|${(f.brand ?? '').toLowerCase()}`
}

/** Newest-first list of distinct foods, with how often (and at which meals) each was had.
 *  `measuresFor` restores household serving sizes the log doesn't store. */
export function buildFoodHistory(
  rows: HistoryRow[],
  measuresFor: (name: string) => FoodMeasure[] = () => []
): HistoryFood[] {
  const newestFirst = [...rows].sort(
    (a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (b.id ?? 0) - (a.id ?? 0)
  )
  const byKey = new Map<string, HistoryFood>()
  for (const r of newestFirst) {
    const key = foodKey(r)
    let h = byKey.get(key)
    if (!h) {
      const per100g =
        r.unit === '100g'
          ? {
              calories: r.baseCalories,
              protein: r.baseProtein,
              carbs: r.baseCarbs,
              fat: r.baseFat,
              fibre: r.baseFibre
            }
          : undefined
      h = {
        key,
        item: {
          name: r.name,
          brand: r.brand,
          barcode: r.barcode,
          servingDesc: r.unit === '100g' ? 'per 100 g' : null,
          unit: r.unit,
          calories: r.baseCalories,
          protein: r.baseProtein,
          carbs: r.baseCarbs,
          fat: r.baseFat,
          fibre: r.baseFibre,
          source: 'recent',
          per100g,
          measures: per100g ? measuresFor(r.name) : []
        },
        count: 0,
        countByMeal: Object.fromEntries(MEAL_TYPES.map((m) => [m, 0])) as Record<MealType, number>,
        last: { unit: r.unit, amount: r.amount, date: r.date }
      }
      byKey.set(key, h)
    }
    h.count++
    h.countByMeal[r.mealType]++
  }
  return [...byKey.values()]
}

/**
 * What to offer before anything is typed: foods you've had at THIS meal at least twice
 * ("usual"), most often first; then everything else, most recent first. `exclude` drops
 * foods already shown elsewhere (favourites).
 */
export function suggestFoods(
  history: HistoryFood[],
  meal: MealType,
  opts: { exclude?: Set<string>; usualLimit?: number; recentLimit?: number } = {}
): { usual: HistoryFood[]; recent: HistoryFood[] } {
  const exclude = opts.exclude ?? new Set<string>()
  const pool = history.filter((h) => !exclude.has(h.key))
  const usual = pool
    .filter((h) => h.countByMeal[meal] >= 2)
    .map((h, i) => ({ h, i }))
    .sort((a, b) => b.h.countByMeal[meal] - a.h.countByMeal[meal] || a.i - b.i)
    .map(({ h }) => h)
    .slice(0, opts.usualLimit ?? 6)
  const shown = new Set(usual.map((h) => h.key))
  const recent = pool.filter((h) => !shown.has(h.key)).slice(0, opts.recentLimit ?? 6)
  return { usual, recent }
}

/** Your own foods matching a query — every word must start a word of the name or brand —
 *  most-logged first. These lead the search results: it's almost always one of them. */
export function searchHistory(history: HistoryFood[], query: string, limit = 5): HistoryFood[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return history
    .filter((h) => {
      const hay = `${h.item.name} ${h.item.brand ?? ''}`.toLowerCase().split(/[^a-z0-9]+/)
      return words.every((w) => hay.some((t) => t.startsWith(w)))
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/** "Last time: 60 g" / "1.5 serves" — the remembered amount in words. */
export function rememberedLabel(last: { unit: string; amount: number }): string {
  if (last.unit === '100g') return `${Math.round(last.amount * 100)} g`
  const n = Math.round(last.amount * 10) / 10
  return `${n} serve${n === 1 ? '' : 's'}`
}

/** Where the Add Food amount picker starts. */
export type StartingAmount =
  | { kind: 'flexible'; mode: 'g' | 'serving'; grams: number; measureIdx: number; count: number }
  | { kind: 'legacy'; value: number }

/**
 * Start the amount at what you had last time, so a staple needs no adjusting. A remembered
 * gram amount that is a clean multiple (in halves) of a household measure comes back as
 * that measure — 60 g of bread with a 30 g slice reads "2 × 1 slice" — otherwise as grams.
 * Without a memory (or one in a different unit) it is the usual default: the first
 * serving, else 100 g.
 */
export function startingAmount(
  item: FoodItem,
  last: { unit: string; amount: number } | null
): StartingAmount {
  const measures = item.measures ?? []
  const flexible = item.per100g !== undefined || item.unit === '100g'
  if (!flexible) {
    const base = item.unit === '100g' ? 100 : 1
    const remembered =
      last && last.unit === item.unit
        ? item.unit === '100g'
          ? last.amount * 100
          : last.amount
        : null
    return { kind: 'legacy', value: remembered && remembered > 0 ? remembered : base }
  }

  const fallback: StartingAmount = {
    kind: 'flexible',
    mode: measures.length ? 'serving' : 'g',
    grams: measures[0]?.grams ?? 100,
    measureIdx: 0,
    count: 1
  }
  if (!last || last.unit !== '100g' || !(last.amount > 0)) return fallback

  const grams = last.amount * 100
  for (let i = 0; i < measures.length; i++) {
    const halves = (grams / measures[i].grams) * 2
    if (halves >= 1 && Math.abs(halves - Math.round(halves)) < 0.02) {
      return {
        kind: 'flexible',
        mode: 'serving',
        grams,
        measureIdx: i,
        count: Math.round(halves) / 2
      }
    }
  }
  return { kind: 'flexible', mode: 'g', grams: Math.round(grams), measureIdx: 0, count: 1 }
}
