import { describe, it, expect } from 'vitest'
import { mapOffProduct, searchStaples } from '../src/shared/nutrition'

describe('mapOffProduct', () => {
  it('prefers per-serving macros when OpenFoodFacts supplies them', () => {
    const product = {
      product_name: 'Greek Yogurt',
      brands: 'Fage, Total',
      code: '5000159407236',
      serving_size: '170 g',
      serving_quantity: 170,
      nutriments: {
        'energy-kcal_100g': 59,
        proteins_100g: 10,
        carbohydrates_100g: 3.6,
        fat_100g: 0.4,
        'energy-kcal_serving': 100,
        proteins_serving: 17,
        carbohydrates_serving: 6,
        fat_serving: 0.7
      }
    }
    expect(mapOffProduct(product, 'barcode')).toEqual({
      name: 'Greek Yogurt',
      brand: 'Fage',
      barcode: '5000159407236',
      servingDesc: '170 g',
      unit: 'serving',
      calories: 100,
      protein: 17,
      carbs: 6,
      fat: 0.7,
      source: 'barcode',
      // Canonical per-100 g basis + serving measure enable the grams⇄serving picker.
      per100g: { calories: 59, protein: 10, carbs: 3.6, fat: 0.4 },
      measures: [{ desc: '170 g', grams: 170 }]
    })
  })

  it('falls back to per-100 g when there is no serving info', () => {
    const item = mapOffProduct({
      product_name: 'Olive Oil',
      code: 123,
      nutriments: {
        'energy-kcal_100g': 884,
        proteins_100g: 0,
        carbohydrates_100g: 0,
        fat_100g: 100
      }
    })
    expect(item).toMatchObject({
      name: 'Olive Oil',
      barcode: '123',
      unit: '100g',
      servingDesc: 'per 100 g',
      calories: 884,
      fat: 100,
      source: 'search'
    })
  })

  it('derives missing per-serving macros from per-100 g data instead of zeroing them', () => {
    // OFF often has serving calories but not serving protein/carbs/fat. With a
    // numeric serving_quantity we can scale the per-100 g values rather than log 0.
    const item = mapOffProduct({
      product_name: 'Protein Pudding',
      serving_size: '200 g',
      serving_quantity: 200,
      nutriments: {
        'energy-kcal_100g': 80,
        proteins_100g: 10,
        carbohydrates_100g: 5.2,
        fat_100g: 1.5,
        'energy-kcal_serving': 160
      }
    })
    expect(item).toMatchObject({
      unit: 'serving',
      calories: 160,
      protein: 20, // 10 g/100g × 200 g
      carbs: 10.4,
      fat: 3
    })
  })

  it('labels a serving measure with OpenFoodFacts own unit, not always grams', () => {
    const drink = mapOffProduct({
      product_name: 'Iced Coffee',
      serving_quantity: 250,
      serving_quantity_unit: 'ml',
      nutriments: { 'energy-kcal_100g': 60 }
    })
    expect(drink?.measures?.[0].desc).toBe('250 ml')
    // serving_size still wins when OFF supplies one, and solids stay on grams.
    const solid = mapOffProduct({
      product_name: 'Rice Cakes',
      serving_quantity: 12,
      nutriments: { 'energy-kcal_100g': 380 }
    })
    expect(solid?.measures?.[0].desc).toBe('12 g')
  })

  it('returns null when the product has no name or no usable macros', () => {
    expect(mapOffProduct({ nutriments: { 'energy-kcal_100g': 100 } })).toBeNull()
    expect(mapOffProduct({ product_name: 'Mystery' })).toBeNull()
    expect(mapOffProduct({ product_name: 'Empty', nutriments: {} })).toBeNull()
  })
})

describe('searchStaples (AU generic foods)', () => {
  it('finds generics by substring, on a per-100 g basis', () => {
    const results = searchStaples('chicken')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.source === 'staple' && r.unit === '100g')).toBe(true)
    expect(results.every((r) => r.per100g && r.calories === r.per100g.calories)).toBe(true)
    expect(results.some((r) => r.name.toLowerCase().includes('chicken'))).toBe(true)
  })

  it('ranks a head-name hit above a deep substring match', () => {
    // "Pasta, …" must beat "…with pasta…" — this is the fix for "pasta → branded junk".
    const top = searchStaples('pasta')[0]
    expect(top.name.toLowerCase().startsWith('pasta')).toBe(true)
  })

  it('carries real serving measures for common foods (grams fallback otherwise)', () => {
    const pasta = searchStaples('pasta').find((r) => /boiled/i.test(r.name))
    expect(pasta?.measures?.length).toBeGreaterThan(0)
    expect(pasta?.measures?.every((m) => m.grams > 0 && m.desc)).toBe(true)
  })

  it('returns nothing for an empty query', () => {
    expect(searchStaples('')).toEqual([])
    expect(searchStaples('   ')).toEqual([])
  })

  // The old substring matcher tested the raw query against the joined name, so every
  // plural came back EMPTY — the AFCD spells these "Egg,", "Tomato,", "Potato,",
  // "Strawberry," and "wrap".
  it.each(['eggs', 'tomatoes', 'potatoes', 'strawberries', 'wraps', 'oats'])(
    'finds generics for the plural "%s"',
    (q) => {
      expect(searchStaples(q).length).toBeGreaterThan(0)
    }
  )

  it('matches whole words, so "rice" is not Liquorice', () => {
    expect(searchStaples('rice').some((r) => /liquorice/i.test(r.name))).toBe(false)
  })

  it('prefix-matches the last word so live filtering works as you type', () => {
    expect(searchStaples('chick').some((r) => /^chicken/i.test(r.name))).toBe(true)
  })

  it('accepts the US spelling the AFCD does not use', () => {
    expect(searchStaples('yogurt').length).toBeGreaterThan(0)
  })

  it('backs off to the head noun when the full phrase matches nothing', () => {
    // No AFCD food says "greek", so the query falls back to "yoghurt" rather than
    // returning nothing at all.
    const r = searchStaples('greek yoghurt')
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((x) => /yoghurt/i.test(x.name))).toBe(true)
  })

  it('never backs off onto a bare qualifier', () => {
    // "frozen" alone would happily match Banana, frozen — an ingredient the table
    // genuinely lacks must stay honestly empty.
    expect(searchStaples('frozen edamame')).toEqual([])
  })

  // Multi-word queries used to all score identically, leaving the SHORTEST name to win.
  it('ranks the food the query names above one that merely mentions it', () => {
    const top = searchStaples('beef mince')[0]
    expect(top.name.toLowerCase().startsWith('beef, mince')).toBe(true)
  })

  it('prefers the everyday form over an odd one at the same relevance', () => {
    // Both are "Milk, …" head hits; the neutral cow's milk must beat human breast milk,
    // which used to win the name-length tiebreak by two characters.
    expect(searchStaples('milk')[0].name).toMatch(/^Milk, cow/)
    // Whole egg, not the yolk (313 kcal/100 g) or the white (47).
    expect(searchStaples('egg')[0].name).toMatch(/whole/i)
    // Neutral markers stack: regular-fat natural yoghurt over natural sheep's yoghurt.
    expect(searchStaples('yoghurt')[0].name).toMatch(/regular fat/i)
  })

  it('does not treat a packaged product as the neutral form', () => {
    // "Potato, wedges, REGULAR, purchased frozen, baked" (175 kcal) used to take the
    // neutral-form bonus and outrank plain potato (56–67).
    expect(searchStaples('potato')[0].name).not.toMatch(/wedge/i)
  })

  it('still honours a part when the query asks for it', () => {
    expect(searchStaples('egg yolk')[0].name).toMatch(/yolk/i)
  })
})

describe('mapOffProduct — kilojoule labels', () => {
  it('derives kcal from kilojoules when OpenFoodFacts has no kcal field', () => {
    // Australian labels are kJ-first and OFF stores what the label says. Six of the
    // eighteen branded results for "eggs" carry only energy-kj_100g.
    const product = {
      product_name: 'Eggs',
      brands: 'McLaren Vale Free Range Eggs',
      code: '9315748109986',
      nutriments: {
        'energy-kj_100g': 559,
        proteins_100g: 12.2,
        carbohydrates_100g: 1.3,
        fat_100g: 9.9
      }
    }
    const item = mapOffProduct(product, 'search')
    expect(item).not.toBeNull()
    expect(item!.calories).toBe(134) // 559 / 4.184 = 133.6
    expect(item!.per100g!.calories).toBe(134)
  })

  it('prefers the label kcal figure when both units are present', () => {
    const product = {
      product_name: 'Bread',
      brands: 'Tip Top',
      code: '9300601000012',
      nutriments: {
        'energy-kcal_100g': 260,
        'energy-kj_100g': 1200,
        proteins_100g: 9,
        carbohydrates_100g: 45,
        fat_100g: 3
      }
    }
    expect(mapOffProduct(product, 'search')!.calories).toBe(260)
  })

  it('still drops a product with no nutriment data at all', () => {
    const product = {
      product_name: 'Farm Fresh Eggs',
      brands: 'Farmhouse Fresh',
      code: '9310229800185',
      nutriments: {}
    }
    expect(mapOffProduct(product, 'search')).toBeNull()
  })
})

describe('mapOffProduct — missing energy', () => {
  it('drops a product that has macros but no energy figure in either unit', () => {
    // "Extra large cage eggs · Sunrise eggs" — OFF holds fat/carbs/sugars and no energy.
    // Logging it would add its macros to the day against zero calories.
    const product = {
      product_name: 'Extra large cage eggs',
      brands: 'Sunrise eggs',
      code: '9351974041027',
      nutriments: { fat_100g: 10.3, sugars_100g: 0.3, carbohydrates_100g: 1.4 }
    }
    expect(mapOffProduct(product, 'search')).toBeNull()
  })
})
