import { describe, it, expect } from 'vitest'
import { mapOffProduct, offProductIdentity, searchStaples } from '../src/shared/nutrition'
import {
  normalizeSalHit,
  rankPackagedResults,
  sanitizeSearchQuery
} from '../src/shared/food-search'
import type { FoodItem } from '../src/shared/types'

describe('mapOffProduct — data quality', () => {
  it('falls back to the English or generic name when product_name is empty', () => {
    const item = mapOffProduct({
      product_name: '',
      product_name_en: 'Rolled Oats',
      nutriments: {
        'energy-kcal_100g': 375,
        proteins_100g: 12,
        carbohydrates_100g: 60,
        fat_100g: 8
      }
    })
    expect(item?.name).toBe('Rolled Oats')
  })

  it('derives per-100 g energy from the serve instead of recording 0 kcal', () => {
    // Serve energy only, but a per-100 g protein figure — the basis used to be built
    // from the protein alone with calories 0, so logging by grams recorded no energy.
    const item = mapOffProduct({
      product_name: 'Protein Bar',
      serving_size: '60 g',
      serving_quantity: 60,
      nutriments: { 'energy-kcal_serving': 240, proteins_100g: 33 }
    })
    expect(item?.per100g?.calories).toBe(400)
    expect(item?.per100g?.protein).toBe(33)
  })

  it('reads the kJ figure when it was also typed into the kcal field', () => {
    const item = mapOffProduct({
      product_name: 'Muesli',
      nutriments: {
        'energy-kcal_100g': 1590,
        'energy-kj_100g': 1590,
        proteins_100g: 10,
        carbohydrates_100g: 60,
        fat_100g: 8
      }
    })
    expect(item?.calories).toBe(380)
  })

  it('drops a physically impossible per-100 g basis', () => {
    // Per-kg values entered as per-100 g.
    const bad = mapOffProduct({
      product_name: 'Rice',
      nutriments: {
        'energy-kcal_100g': 3600,
        proteins_100g: 70,
        carbohydrates_100g: 800,
        fat_100g: 6
      }
    })
    expect(bad).toBeNull()
  })

  it('keeps the per-serve figures when only the per-100 g basis is broken', () => {
    const item = mapOffProduct({
      product_name: 'Chips',
      serving_size: '30 g',
      serving_quantity: 30,
      nutriments: {
        'energy-kcal_serving': 160,
        'energy-kcal_100g': 5300,
        fat_100g: 30
      }
    })
    expect(item?.calories).toBe(160)
    expect(item?.per100g).toBeUndefined()
    expect(item?.measures).toEqual([])
  })
})

describe('offProductIdentity', () => {
  it('returns the name and first brand, or null without a name', () => {
    expect(
      offProductIdentity({ generic_name: 'Wholemeal bread', brands: 'Tip Top, George Weston' })
    ).toEqual({ name: 'Wholemeal bread', brand: 'Tip Top' })
    expect(offProductIdentity({ brands: 'Tip Top' })).toBeNull()
  })
})

describe('searchStaples — alternate names', () => {
  const first = (q: string): string => searchStaples(q)[0]?.name ?? ''
  it.each([
    ['ground beef ', 'Beef, mince'],
    ['bell pepper ', 'Capsicum'],
    ['shrimp ', 'Prawn'],
    ['cookies ', 'Biscuit'],
    ['cantaloupe ', 'Melon, rockmelon'],
    ['french fries ', 'Potato'],
    ['snap peas ', 'Snow pea']
  ])('%s → %s', (q, expected) => {
    expect(first(q).startsWith(expected)).toBe(true)
  })
})

describe('sanitizeSearchQuery', () => {
  it('strips the query syntax that made Search-a-licious return nothing', () => {
    expect(sanitizeSearchQuery('coke (zero)')).toBe('coke zero')
    expect(sanitizeSearchQuery('brand:"Arnott\'s"')).toBe('brand Arnott s')
    expect(sanitizeSearchQuery('70% dark')).toBe('70 dark')
  })
  it('turns boolean operators into plain words', () => {
    expect(sanitizeSearchQuery('salt AND vinegar')).toBe('salt and vinegar')
  })
  it('returns empty for a query that is all syntax', () => {
    expect(sanitizeSearchQuery('()":')).toBe('')
  })
})

describe('normalizeSalHit', () => {
  it('carries the serving unit and alternate names through', () => {
    const n = normalizeSalHit({
      product_name_en: 'Iced Coffee',
      serving_quantity: 250,
      serving_quantity_unit: 'ml'
    })
    expect(n.serving_quantity_unit).toBe('ml')
    expect(n.product_name_en).toBe('Iced Coffee')
  })
})

describe('rankPackagedResults', () => {
  const food = (name: string, brand: string | null, basis = true): FoodItem => ({
    name,
    brand,
    barcode: name,
    servingDesc: null,
    unit: 'serving',
    calories: 100,
    protein: 1,
    carbs: 1,
    fat: 1,
    source: 'search',
    per100g: basis ? { calories: 100, protein: 1, carbs: 1, fat: 1 } : undefined
  })

  it('ranks full name/brand matches first, keeping upstream order within a tier', () => {
    const out = rankPackagedResults('greek yoghurt', [
      food('Strawberry Dessert', 'Brand A'),
      food('Natural Yoghurt', 'Brand B'),
      food('Greek Style Yoghurt', 'Chobani'),
      food('Greek Yoghurt Pot', 'Jalna')
    ])
    expect(out.map((f) => f.name)).toEqual([
      'Greek Style Yoghurt',
      'Greek Yoghurt Pot',
      'Natural Yoghurt',
      'Strawberry Dessert'
    ])
  })

  it('matches brands and plural queries', () => {
    const out = rankPackagedResults('arnotts biscuits', [
      food('Choc Chip', 'Woolworths'),
      food('Scotch Finger Biscuit', "Arnott's")
    ])
    expect(out[0].brand).toBe("Arnott's")
  })

  it('prefers a product with a per-100 g basis within the same tier', () => {
    const out = rankPackagedResults('tuna', [food('Tuna A', null, false), food('Tuna B', null)])
    expect(out.map((f) => f.name)).toEqual(['Tuna B', 'Tuna A'])
  })
})
