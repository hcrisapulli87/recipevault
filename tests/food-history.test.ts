import { describe, it, expect } from 'vitest'
import {
  buildFoodHistory,
  foodKey,
  rememberedLabel,
  searchHistory,
  startingAmount,
  suggestFoods
} from '../src/shared/food-history'
import type { HistoryRow } from '../src/shared/food-history'
import type { MealType } from '../src/shared/types'

let id = 1
const row = (
  date: string,
  mealType: MealType,
  name: string,
  over: Partial<HistoryRow> = {}
): HistoryRow => ({
  id: id++,
  date,
  mealType,
  name,
  brand: null,
  barcode: null,
  unit: '100g',
  amount: 1,
  baseCalories: 100,
  baseProtein: 5,
  baseCarbs: 10,
  baseFat: 2,
  baseFibre: null,
  source: 'staple',
  ...over
})

describe('buildFoodHistory', () => {
  const rows = [
    row('2026-10-10', 'breakfast', 'Oats', { amount: 0.4 }),
    row('2026-10-17', 'breakfast', 'Oats', { amount: 0.6 }), // newest → remembered
    row('2026-10-15', 'lunch', 'Oats', { amount: 0.5 }),
    row('2026-10-18', 'snack', 'Tim Tam', { unit: 'serving', brand: 'Arnott’s', barcode: '931' })
  ]
  const history = buildFoodHistory(rows, (n) =>
    n === 'Oats' ? [{ desc: '½ cup', grams: 40 }] : []
  )

  it('folds repeat logs into one food, newest first, with counts per meal', () => {
    expect(history.map((h) => h.item.name)).toEqual(['Tim Tam', 'Oats'])
    const oats = history[1]
    expect(oats.count).toBe(3)
    expect(oats.countByMeal).toMatchObject({ breakfast: 2, lunch: 1, dinner: 0 })
  })

  it('remembers the most recent amount, and restores the per-100 g basis and measures', () => {
    const oats = history[1]
    expect(oats.last).toEqual({ unit: '100g', amount: 0.6, date: '2026-10-17' })
    expect(oats.item.per100g?.calories).toBe(100)
    expect(oats.item.measures).toEqual([{ desc: '½ cup', grams: 40 }])
  })

  it('keys by barcode when there is one, else name + brand', () => {
    expect(foodKey({ name: 'X', brand: null, barcode: '931' })).toBe('bc:931')
    expect(foodKey({ name: 'Oats', brand: 'Uncle Tobys', barcode: null })).toBe('oats|uncle tobys')
  })
})

describe('suggestFoods', () => {
  const history = buildFoodHistory([
    row('2026-10-01', 'breakfast', 'Oats'),
    row('2026-10-02', 'breakfast', 'Oats'),
    row('2026-10-03', 'breakfast', 'Oats'),
    row('2026-10-04', 'breakfast', 'Coffee'),
    row('2026-10-05', 'breakfast', 'Coffee'),
    row('2026-10-06', 'breakfast', 'Toast'), // once — recent, not usual
    row('2026-10-07', 'dinner', 'Curry')
  ])

  it('offers foods had at this meal at least twice, most often first, then recents', () => {
    const s = suggestFoods(history, 'breakfast')
    expect(s.usual.map((h) => h.item.name)).toEqual(['Oats', 'Coffee'])
    expect(s.recent.map((h) => h.item.name)).toEqual(['Curry', 'Toast'])
  })

  it('leaves out foods already shown as favourites', () => {
    const s = suggestFoods(history, 'breakfast', { exclude: new Set(['oats|']) })
    expect(s.usual.map((h) => h.item.name)).toEqual(['Coffee'])
  })

  it('has no usual foods for a meal never logged twice', () => {
    expect(suggestFoods(history, 'lunch').usual).toEqual([])
  })
})

describe('searchHistory', () => {
  const history = buildFoodHistory([
    row('2026-10-01', 'lunch', 'Bread, wholemeal', { brand: 'Tip Top' }),
    row('2026-10-02', 'lunch', 'Bread, wholemeal', { brand: 'Tip Top' }),
    row('2026-10-03', 'lunch', 'Bread, white', { brand: 'Wonder' }),
    row('2026-10-04', 'snack', 'Tim Tam', { brand: 'Arnott’s' })
  ])

  it('matches word prefixes across name and brand, most-logged first', () => {
    expect(searchHistory(history, 'tip').map((h) => h.item.brand)).toEqual(['Tip Top'])
    expect(searchHistory(history, 'bre').map((h) => h.item.brand)).toEqual(['Tip Top', 'Wonder'])
    expect(searchHistory(history, 'white bread').map((h) => h.item.brand)).toEqual(['Wonder'])
  })

  it('does not match inside a word', () => {
    expect(searchHistory(history, 'read')).toEqual([])
  })
})

describe('rememberedLabel', () => {
  it('reads grams and serves', () => {
    expect(rememberedLabel({ unit: '100g', amount: 0.6 })).toBe('60 g')
    expect(rememberedLabel({ unit: 'serving', amount: 1.5 })).toBe('1.5 serves')
    expect(rememberedLabel({ unit: 'serving', amount: 1 })).toBe('1 serve')
  })
})

describe('startingAmount', () => {
  const bread = {
    name: 'Bread',
    brand: null,
    barcode: null,
    servingDesc: 'per 100 g',
    unit: '100g',
    calories: 240,
    protein: 9,
    carbs: 42,
    fat: 3,
    source: 'staple' as const,
    per100g: { calories: 240, protein: 9, carbs: 42, fat: 3 },
    measures: [
      { desc: '1 slice', grams: 30 },
      { desc: '2 slices', grams: 60 }
    ]
  }

  it('starts at the first serving with no memory', () => {
    expect(startingAmount(bread, null)).toEqual({
      kind: 'flexible',
      mode: 'serving',
      grams: 30,
      measureIdx: 0,
      count: 1
    })
  })

  it('brings a remembered amount back as a clean multiple of a serving', () => {
    expect(startingAmount(bread, { unit: '100g', amount: 0.9 })).toMatchObject({
      mode: 'serving',
      measureIdx: 0,
      count: 3 // 90 g = 3 × 1 slice
    })
  })

  it('falls back to grams when no serving divides it', () => {
    expect(startingAmount(bread, { unit: '100g', amount: 0.47 })).toMatchObject({
      mode: 'g',
      grams: 47
    })
  })

  it('remembers serves for a per-serve-only food', () => {
    const bar = { ...bread, unit: 'serving', per100g: undefined, measures: [] }
    expect(startingAmount(bar, { unit: 'serving', amount: 2 })).toEqual({
      kind: 'legacy',
      value: 2
    })
    expect(startingAmount(bar, { unit: '100g', amount: 2 })).toEqual({ kind: 'legacy', value: 1 })
  })
})
