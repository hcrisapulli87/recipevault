import { describe, it, expect } from 'vitest'
import { planItemToFood, planSlotToFood } from '../src/shared/plan-to-food'
import type { MealPlanEntry, RecipeSummary } from '../src/shared/types'

const recipe = (patch: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id: 7,
  ownerId: 'owner',
  title: 'Greek Chicken Tray Bake',
  imageUrl: null,
  totalMin: 75,
  servings: 6,
  est: { calories: 500, protein: 47, carbs: 25, fat: 22, matched: 10, total: 10, assumedServings: false },
  isCatalog: true,
  catalogSlug: 'greek-chicken-tray-bake',
  cuisine: 'greek',
  dietTags: ['balanced'],
  mealSlots: ['dinner', 'lunch'],
  effort: 'easy',
  keepsDays: 3,
  batchFriendly: true,
  reheat: 'oven',
  ...patch
})

const slot = (patch: Partial<MealPlanEntry> = {}): MealPlanEntry => ({
  day: 'monday',
  meal: 'dinner',
  recipeId: 7,
  freeText: null,
  isLeftover: false,
  cookDay: null,
  servingsPlanned: 6,
  ...patch
})

describe('planItemToFood', () => {
  it('carries the recipe’s per-serving estimate through as a loggable item', () => {
    const food = planItemToFood(recipe(), 'dinner')!
    expect(food).toMatchObject({
      name: 'Greek Chicken Tray Bake',
      unit: 'serving',
      source: 'plan',
      calories: 500,
      protein: 47
    })
  })

  it('labels the item as a planned meal, and says so when it is leftovers', () => {
    expect(planItemToFood(recipe(), 'lunch')!.servingDesc).toBe(
      'planned lunch · best-guess macros'
    )
    expect(planItemToFood(recipe(), 'lunch', { isLeftover: true })!.servingDesc).toBe(
      'planned lunch · leftovers · best-guess macros'
    )
  })

  it('returns null rather than logging zeroes when there is no estimate', () => {
    expect(planItemToFood(recipe({ est: null }), 'dinner')).toBeNull()
  })
})

describe('planSlotToFood', () => {
  it('resolves the slot’s recipe', () => {
    expect(planSlotToFood(slot(), [recipe()])!.calories).toBe(500)
  })

  it('logs a leftover slot with the same macros as its cook night', () => {
    const cook = planSlotToFood(slot(), [recipe()])!
    const left = planSlotToFood(
      slot({ day: 'tuesday', meal: 'lunch', isLeftover: true, cookDay: 'monday' }),
      [recipe()]
    )!
    expect(left.calories).toBe(cook.calories)
    expect(left.protein).toBe(cook.protein)
    expect(left.name).toBe(cook.name)
  })

  it('returns null for an empty or free-text slot', () => {
    expect(planSlotToFood(slot({ recipeId: null }), [recipe()])).toBeNull()
    expect(
      planSlotToFood(slot({ recipeId: null, freeText: 'Dinner at Mum’s' }), [recipe()])
    ).toBeNull()
  })

  it('returns null when the recipe is no longer in the library', () => {
    expect(planSlotToFood(slot({ recipeId: 999 }), [recipe()])).toBeNull()
  })
})
