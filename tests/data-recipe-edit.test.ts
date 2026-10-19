import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateRecipe } from '../src/renderer/data/recipes'
import { setFavourite, setRecipeNotes } from '../src/renderer/data/recipePrefs'
import type { DraftRecipe } from '../src/shared/types'

// Records every query as { table, op, arg, filters, ids } in call order, so tests can
// assert the insert-before-delete discipline and what a failure rolls back.
interface Op {
  table: string
  op: string
  arg?: unknown
  options?: unknown
  filters: [string, unknown][]
  ids?: unknown[]
}

const state = vi.hoisted(() => ({
  log: [] as Op[],
  /** Table whose insert returns an error, to exercise the rollback. */
  failInsert: null as string | null,
  oldIngredientIds: [1, 2],
  oldStepIds: [10],
  planRows: [] as Record<string, unknown>[],
  nextId: 100
}))

vi.mock('../src/renderer/data/users', () => ({
  myId: () => Promise.resolve('me-uuid')
}))

vi.mock('../src/renderer/data/supabase', () => {
  const resultFor = (o: Op): { data: unknown; error: { message: string } | null } => {
    if (o.op === 'select' && o.table === 'ingredients')
      return { data: state.oldIngredientIds.map((id) => ({ id })), error: null }
    if (o.op === 'select' && o.table === 'steps')
      return { data: state.oldStepIds.map((id) => ({ id })), error: null }
    if (o.op === 'select' && o.table === 'meal_plan') return { data: state.planRows, error: null }
    if (o.op === 'insert') {
      if (state.failInsert === o.table) return { data: null, error: { message: 'insert failed' } }
      return { data: (o.arg as unknown[]).map(() => ({ id: state.nextId++ })), error: null }
    }
    return { data: null, error: null }
  }

  const start = (table: string, op: string, arg?: unknown, options?: unknown): unknown => {
    const o: Op = { table, op, arg, options, filters: [] }
    state.log.push(o)
    const node: Record<string, unknown> = {
      // insert(...).select('id') stays the same op, it just asks for ids back
      select: () => node,
      eq: (col: string, value: unknown) => {
        o.filters.push([col, value])
        return node
      },
      in: (_col: string, ids: unknown[]) => {
        o.ids = ids
        return node
      },
      then: (ok: (r: unknown) => unknown) => Promise.resolve(resultFor(o)).then(ok)
    }
    return node
  }

  return {
    supabase: {
      from: (table: string) => ({
        select: () => start(table, 'select'),
        insert: (rows: unknown) => start(table, 'insert', rows),
        update: (patch: unknown) => start(table, 'update', patch),
        delete: () => start(table, 'delete'),
        upsert: (row: unknown, options: unknown) => start(table, 'upsert', row, options)
      })
    }
  }
})

const draft: DraftRecipe = {
  title: 'Better curry',
  sourceUrl: null,
  imageUrl: null,
  description: '',
  servings: 4,
  prepMin: 10,
  cookMin: 20,
  totalMin: 30,
  ingredients: [
    { position: 0, raw: '2 onions', quantity: 2, quantityMax: null, unit: null, name: 'onions' }
  ],
  steps: [{ position: 0, section: null, text: 'Cook it.' }],
  confidence: 'manual'
}

const ops = (table: string, op: string): Op[] =>
  state.log.filter((o) => o.table === table && o.op === op)

beforeEach(() => {
  state.log = []
  state.failInsert = null
  state.planRows = []
  state.nextId = 100
})

describe('updateRecipe', () => {
  it('inserts the new ingredients and steps before deleting the old ones', async () => {
    await updateRecipe(7, draft)

    const order = state.log
      .filter((o) => o.table !== 'meal_plan' && o.op !== 'select')
      .map((o) => `${o.op}:${o.table}`)
    expect(order).toEqual([
      'insert:ingredients',
      'insert:steps',
      'update:recipes',
      'delete:ingredients',
      'delete:steps'
    ])
    // Only the rows that existed before the edit are removed, never the fresh ones.
    expect(ops('ingredients', 'delete')[0].ids).toEqual([1, 2])
    expect(ops('steps', 'delete')[0].ids).toEqual([10])
    expect(ops('recipes', 'update')[0].arg).toMatchObject({ title: 'Better curry', servings: 4 })
  })

  it('rolls back only what it added when a later insert fails', async () => {
    state.failInsert = 'steps'

    await expect(updateRecipe(7, draft)).rejects.toThrow('insert failed')

    // The new ingredient (id 100) is removed; the old rows and the recipe are untouched.
    const deletes = state.log.filter((o) => o.op === 'delete')
    expect(deletes).toHaveLength(1)
    expect(deletes[0]).toMatchObject({ table: 'ingredients', ids: [100] })
    expect(ops('recipes', 'update')).toHaveLength(0)
  })

  it('relabels my own plan slots with the new title, leftovers included', async () => {
    state.planRows = [
      { day: 'monday', meal: 'dinner', free_text: null, is_leftover: false },
      { day: 'tuesday', meal: 'lunch', free_text: null, is_leftover: true }
    ]

    await updateRecipe(7, draft)

    expect(ops('meal_plan', 'select')[0].filters).toEqual([
      ['owner_id', 'me-uuid'],
      ['recipe_id', 7]
    ])
    expect(ops('meal_plan', 'update').map((o) => o.arg)).toEqual([
      { meal_text: 'Better curry' },
      { meal_text: 'Leftovers · Better curry' }
    ])
  })
})

describe('recipe prefs', () => {
  it('a heart sends only the favourite flag, so it never wipes a note', async () => {
    await setFavourite(7, true)
    const [o] = ops('recipe_prefs', 'upsert')
    expect(o.arg).toMatchObject({ owner_id: 'me-uuid', recipe_id: 7, favourite: true })
    expect(o.arg).not.toHaveProperty('notes')
    expect(o.options).toEqual({ onConflict: 'owner_id,recipe_id' })
  })

  it('a note sends only the trimmed notes, so it never clears a heart', async () => {
    await setRecipeNotes(7, '  double the garlic \n')
    const [o] = ops('recipe_prefs', 'upsert')
    expect(o.arg).toMatchObject({ owner_id: 'me-uuid', recipe_id: 7, notes: 'double the garlic' })
    expect(o.arg).not.toHaveProperty('favourite')
  })
})
