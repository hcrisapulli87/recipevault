import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeBotPlan, readBotPlan, mergeBotPlan } from '../src/main/bot-mealplan-sync'
import type { MealPlanEntry } from '../src/shared/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'recipe-vault-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const titleOf = (id: number): string => (id === 1 ? 'Spaghetti Bolognese' : `Recipe ${id}`)

function entries(overrides: Partial<Record<string, Partial<MealPlanEntry>>> = {}): MealPlanEntry[] {
  const days = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday'
  ] as const
  return days.map((day) => ({
    day,
    recipeId: null,
    freeText: null,
    ...overrides[day]
  }))
}

describe('writeBotPlan', () => {
  it('writes the bot meal_plan.json format', () => {
    writeBotPlan(dir, entries({ monday: { recipeId: 1 }, tuesday: { freeText: 'Leftovers' } }), titleOf)
    const written = JSON.parse(readFileSync(join(dir, 'meal_plan.json'), 'utf-8'))
    expect(written).toEqual({
      monday: 'Spaghetti Bolognese',
      tuesday: 'Leftovers',
      wednesday: '',
      thursday: '',
      friday: '',
      saturday: '',
      sunday: ''
    })
  })

  it('does not leave a temp file behind', () => {
    writeBotPlan(dir, entries(), titleOf)
    expect(existsSync(join(dir, 'meal_plan.json.tmp'))).toBe(false)
  })

  it('throws when the folder does not exist', () => {
    expect(() => writeBotPlan(join(dir, 'nope'), entries(), titleOf)).toThrow()
  })
})

describe('readBotPlan', () => {
  it('returns null when missing', () => expect(readBotPlan(dir)).toBeNull())

  it('reads the day map', () => {
    writeFileSync(join(dir, 'meal_plan.json'), JSON.stringify({ monday: 'Pasta' }))
    expect(readBotPlan(dir)).toEqual({ monday: 'Pasta' })
  })

  it('returns null on corrupt JSON', () => {
    writeFileSync(join(dir, 'meal_plan.json'), 'not json {')
    expect(readBotPlan(dir)).toBeNull()
  })
})

describe('mergeBotPlan', () => {
  it('keeps local entries that match what we would export', () => {
    const local = entries({ monday: { recipeId: 1 } })
    const merged = mergeBotPlan(local, { monday: 'Spaghetti Bolognese' }, titleOf)
    expect(merged.find((e) => e.day === 'monday')).toMatchObject({ recipeId: 1, freeText: null })
  })

  it('takes bot-side changes as free text', () => {
    const local = entries({ monday: { recipeId: 1 } })
    const merged = mergeBotPlan(local, { monday: 'Takeaway night' }, titleOf)
    expect(merged.find((e) => e.day === 'monday')).toMatchObject({
      recipeId: null,
      freeText: 'Takeaway night'
    })
  })

  it('clears a day the bot cleared', () => {
    const local = entries({ tuesday: { freeText: 'Leftovers' } })
    const merged = mergeBotPlan(local, { tuesday: '' }, titleOf)
    expect(merged.find((e) => e.day === 'tuesday')).toMatchObject({
      recipeId: null,
      freeText: null
    })
  })

  it('ignores days missing from the bot map', () => {
    const local = entries({ friday: { recipeId: 1 } })
    const merged = mergeBotPlan(local, {}, titleOf)
    expect(merged.find((e) => e.day === 'friday')).toMatchObject({ recipeId: 1 })
  })
})
