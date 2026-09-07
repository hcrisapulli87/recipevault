import { describe, it, expect } from 'vitest'
import { foodLabel } from '../src/shared/food-label'
import type { FoodItem } from '../src/shared/types'

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
