import { describe, it, expect } from 'vitest'
import { foodLabel } from '../src/shared/food-label'
import type { FoodItem } from '../src/shared/types'
import auFoods from '../src/shared/data/au-foods.json'

/** A FoodItem carrying only the fields foodLabel reads. */
function item(partial: Partial<FoodItem>): FoodItem {
  return {
    name: '',
    brand: null,
    barcode: null,
    servingDesc: null,
    unit: '100g',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    source: 'staple',
    ...partial
  }
}

describe('foodLabel — branded products', () => {
  it('keeps the product name verbatim and shows brand + serving as detail', () => {
    const label = foodLabel(
      item({
        name: 'Free Range Eggs Min 700g',
        brand: 'Green Eggs',
        servingDesc: 'per 100 g',
        source: 'search'
      })
    )
    expect(label.title).toBe('Free Range Eggs Min 700g')
    expect(label.detail).toBe('Green Eggs · per 100 g')
  })

  it('does not comma-split a branded name', () => {
    const label = foodLabel(item({ name: 'Eggs, Free Range', brand: 'Coles', source: 'search' }))
    expect(label.title).toBe('Eggs, Free Range')
  })
})

describe('foodLabel — generic foods', () => {
  it('promotes the head and demotes the remaining segments', () => {
    const label = foodLabel(item({ name: 'Kohlrabi, peeled', servingDesc: 'per 100 g' }))
    expect(label.title).toBe('Kohlrabi')
    expect(label.detail).toBe('peeled · per 100 g')
  })

  it('handles a name with no comma at all', () => {
    const label = foodLabel(item({ name: 'Textured vegetable protein/soy granules' }))
    expect(label.title).toBe('Textured vegetable protein/soy granules')
    expect(label.detail).toBe('')
  })
})

describe('foodLabel — preparation', () => {
  it('fronts the preparation word', () => {
    expect(foodLabel(item({ name: 'Egg, chicken, whole, raw' })).title).toBe('Raw egg')
    expect(foodLabel(item({ name: 'Egg, chicken, whole, hard-boiled' })).title).toBe(
      'Hard-boiled egg'
    )
    expect(foodLabel(item({ name: 'Octopus, boiled, no added fat' })).title).toBe('Boiled octopus')
  })

  it('consumes the preparation segment so it is not repeated in the detail', () => {
    const label = foodLabel(item({ name: 'Egg, chicken, whole, raw' }))
    expect(label.title).toBe('Raw egg')
    expect(label.detail).toBe('chicken · whole')
  })

  it('keeps the remainder of a partially matched segment', () => {
    const label = foodLabel(item({ name: 'Peach, canned in pear juice, drained' }))
    expect(label.title).toBe('Canned peach')
    expect(label.detail).toBe('in pear juice · drained')
  })

  it('leaves a food with no preparation word alone', () => {
    expect(foodLabel(item({ name: 'Kohlrabi, peeled' })).title).toBe('Kohlrabi')
  })
})

describe('foodLabel — modifiers and parts', () => {
  it('places a colour or grade modifier before the head', () => {
    expect(foodLabel(item({ name: 'Wine, white, riesling' })).title).toBe('White wine')
    expect(foodLabel(item({ name: 'Capsicum, red, fresh, fried, no added fat' })).title).toBe(
      'Fried red capsicum'
    )
  })

  it('places a body part after the head', () => {
    expect(foodLabel(item({ name: 'Egg, chicken, yolk, raw' })).title).toBe('Raw egg yolk')
    expect(
      foodLabel(item({ name: 'Chicken, thigh, lean flesh, skin & fat, baked, no added fat' })).title
    ).toBe('Baked chicken thigh')
  })

  it('keeps every unconsumed segment in the detail', () => {
    const label = foodLabel(
      item({ name: 'Chicken, thigh, lean flesh, skin & fat, baked, no added fat' })
    )
    expect(label.detail).toBe('lean flesh · skin & fat · no added fat')
  })

  it('takes at most one word per lexicon', () => {
    const label = foodLabel(item({ name: 'Egg, chicken, white (albumen), raw' }))
    expect(label.title).toBe('Raw egg white')
  })
})

describe('foodLabel — category heads', () => {
  it('replaces a bare category head with its specific segment', () => {
    expect(foodLabel(item({ name: 'Nut, peanut, with skin, raw, unsalted' })).title).toBe(
      'Raw peanut'
    )
    expect(foodLabel(item({ name: 'Fish, eel, raw' })).title).toBe('Raw eel')
    expect(foodLabel(item({ name: 'Cheese, edam' })).title).toBe('Edam')
  })

  it('does not consume a multi-word segment as the head', () => {
    const label = foodLabel(item({ name: 'Pasta, white wheat flour & egg, dry' }))
    expect(label.title).toBe('Pasta')
    expect(label.detail).toBe('white wheat flour & egg · dry')
  })

  it('does not treat a non-category head as replaceable', () => {
    expect(foodLabel(item({ name: 'Egg, chicken, whole, raw' })).title).toBe('Raw egg')
  })

  it('leaves a head that is not in the category list alone', () => {
    const label = foodLabel(item({ name: 'Oil, olive' }))
    expect(label.title).toBe('Oil')
    expect(label.detail).toBe('olive')
  })
})

describe('foodLabel — title cap', () => {
  it('drops the part, then the modifier, to stay within 40 characters', () => {
    const label = foodLabel(
      item({ name: 'Breakfast cereal biscuit, wholemeal wheat, regular fat, toasted' })
    )
    expect(label.title.length).toBeLessThanOrEqual(40)
  })
})

describe('foodLabel — corpus invariant over the whole AFCD', () => {
  const foods = auFoods as { name: string }[]

  it('covers every bundled food', () => {
    expect(foods.length).toBeGreaterThan(1500)
  })

  it('always produces a non-empty title of at most 40 characters', () => {
    for (const f of foods) {
      const { title } = foodLabel(item({ name: f.name }))
      expect(title.length, f.name).toBeGreaterThan(0)
      expect(title.length, f.name).toBeLessThanOrEqual(40)
    }
  })

  it('never discards a segment — each appears in the title or the detail', () => {
    for (const f of foods) {
      const { title, detail } = foodLabel(item({ name: f.name }))
      const shown = `${title} ${detail}`.toLowerCase()
      for (const segment of f.name.split(',').map((s) => s.trim().toLowerCase())) {
        if (!segment) continue
        // A segment can be split across the two lines (a lexicon word in the title, its
        // remainder in the detail), so the words are checked rather than the phrase.
        for (const word of segment.split(/[^a-z0-9]+/).filter(Boolean)) {
          expect(shown, `${f.name} — lost "${word}"`).toContain(word)
        }
      }
    }
  })
})
