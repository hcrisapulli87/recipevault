import { describe, it, expect, beforeEach } from 'vitest'
import initSqlJs, { type Database } from 'sql.js'
import {
  createSchema,
  getRecipes,
  getRecipe,
  saveRecipe,
  deleteRecipe,
  getMealPlan,
  setMeal,
  clearWeek
} from '../src/main/db'
import type { DraftRecipe } from '../src/shared/types'

function draft(overrides: Partial<DraftRecipe> = {}): DraftRecipe {
  return {
    title: 'Spaghetti Bolognese',
    sourceUrl: 'https://example.com/bolognese',
    imageUrl: 'https://example.com/bolognese.jpg',
    description: 'A classic.',
    servings: 4,
    prepMin: 15,
    cookMin: 45,
    totalMin: 60,
    confidence: 'structured',
    ingredients: [
      { position: 0, raw: '2 onions', quantity: 2, quantityMax: null, unit: null, name: 'onions' },
      {
        position: 1,
        raw: '400g minced beef',
        quantity: 400,
        quantityMax: null,
        unit: 'g',
        name: 'minced beef'
      }
    ],
    steps: [
      { position: 0, section: null, text: 'Chop the onions.' },
      { position: 1, section: null, text: 'Brown the beef.' }
    ],
    ...overrides
  }
}

let db: Database

beforeEach(async () => {
  const SQL = await initSqlJs()
  db = new SQL.Database()
  createSchema(db)
})

describe('recipes', () => {
  it('round-trips a recipe with ingredients and steps', () => {
    const id = saveRecipe(db, draft())
    const r = getRecipe(db, id)
    expect(r).not.toBeNull()
    expect(r!.title).toBe('Spaghetti Bolognese')
    expect(r!.servings).toBe(4)
    expect(r!.ingredients).toHaveLength(2)
    expect(r!.ingredients[1]).toMatchObject({ unit: 'g', quantity: 400, name: 'minced beef' })
    expect(r!.steps.map((s) => s.text)).toEqual(['Chop the onions.', 'Brown the beef.'])
  })

  it('lists summaries', () => {
    saveRecipe(db, draft())
    saveRecipe(db, draft({ title: 'Pancakes' }))
    const all = getRecipes(db)
    expect(all).toHaveLength(2)
    expect(all.map((r) => r.title).sort()).toEqual(['Pancakes', 'Spaghetti Bolognese'])
  })

  it('saves children under the right recipe even when db.export() runs after each write', () => {
    // Regression: the app wraps db.run to db.export() after every write, which resets
    // sqlite's last_insert_rowid(). saveRecipe must not depend on that surviving.
    const originalRun = db.run.bind(db)
    // @ts-expect-error mirror the app's runtime persistence wrapper
    db.run = (...args) => {
      const result = originalRun(...args)
      db.export()
      return result
    }
    const id = saveRecipe(db, draft())
    expect(id).toBeGreaterThan(0)
    const r = getRecipe(db, id)
    expect(r!.ingredients).toHaveLength(2)
    expect(r!.steps).toHaveLength(2)
  })

  it('deletes recipe and children', () => {
    const id = saveRecipe(db, draft())
    deleteRecipe(db, id)
    expect(getRecipe(db, id)).toBeNull()
    expect(getRecipes(db)).toHaveLength(0)
  })
})

describe('meal plan', () => {
  it('returns all 7 days, empty by default', () => {
    const plan = getMealPlan(db)
    expect(plan).toHaveLength(7)
    expect(plan[0]).toEqual({ day: 'monday', recipeId: null, freeText: null })
  })

  it('sets and clears meals', () => {
    const id = saveRecipe(db, draft())
    setMeal(db, 'monday', id, null)
    setMeal(db, 'tuesday', null, 'Leftovers')
    let plan = getMealPlan(db)
    expect(plan.find((e) => e.day === 'monday')!.recipeId).toBe(id)
    expect(plan.find((e) => e.day === 'tuesday')!.freeText).toBe('Leftovers')
    clearWeek(db)
    plan = getMealPlan(db)
    expect(plan.every((e) => e.recipeId === null && e.freeText === null)).toBe(true)
  })

  it('clears the day slot when its recipe is deleted', () => {
    const id = saveRecipe(db, draft())
    setMeal(db, 'friday', id, null)
    deleteRecipe(db, id)
    expect(getMealPlan(db).find((e) => e.day === 'friday')!.recipeId).toBeNull()
  })
})
