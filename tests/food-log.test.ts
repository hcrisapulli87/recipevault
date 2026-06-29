import { describe, it, expect, beforeEach } from 'vitest'
import initSqlJs, { type Database } from 'sql.js'
import {
  createSchema,
  ensureDefaultProfile,
  getProfiles,
  addProfile,
  updateProfile,
  deleteProfile,
  addLogEntry,
  updateLogEntry,
  deleteLogEntry,
  getDailyLog,
  computeTotals
} from '../src/main/db'
import type { DraftLogEntry, LogEntry } from '../src/shared/types'

const DATE = '2026-06-29'

function entry(over: Partial<DraftLogEntry> = {}): DraftLogEntry {
  return {
    profileId: 1,
    date: DATE,
    mealType: 'breakfast',
    name: 'Rolled oats',
    brand: null,
    amount: 1,
    unit: 'serving',
    baseCalories: 150,
    baseProtein: 5,
    baseCarbs: 27,
    baseFat: 3,
    barcode: null,
    source: 'staple',
    ...over
  }
}

let db: Database

beforeEach(async () => {
  const SQL = await initSqlJs()
  db = new SQL.Database()
  createSchema(db)
})

describe('profiles', () => {
  it('seeds exactly one default profile and is idempotent', () => {
    ensureDefaultProfile(db)
    ensureDefaultProfile(db)
    const profiles = getProfiles(db)
    expect(profiles).toHaveLength(1)
    expect(profiles[0].name).toBe('Me')
  })

  it('adds profiles and stores goals', () => {
    const id = addProfile(db, 'Alex')
    updateProfile(db, id, {
      goals: { calGoal: 2000, proteinGoal: 150, carbsGoal: 200, fatGoal: 60 }
    })
    const p = getProfiles(db).find((x) => x.id === id)!
    expect(p.name).toBe('Alex')
    expect(p).toMatchObject({ calGoal: 2000, proteinGoal: 150, carbsGoal: 200, fatGoal: 60 })
  })
})

describe('daily log', () => {
  beforeEach(() => ensureDefaultProfile(db))

  it('groups entries by meal and totals what was consumed', () => {
    addLogEntry(db, entry({ mealType: 'breakfast', amount: 2 })) // 2× oats
    addLogEntry(
      db,
      entry({
        mealType: 'lunch',
        name: 'Chicken',
        baseCalories: 200,
        baseProtein: 40,
        baseCarbs: 0,
        baseFat: 4
      })
    )

    const log = getDailyLog(db, 1, DATE)
    expect(log.meals.breakfast).toHaveLength(1)
    expect(log.meals.lunch).toHaveLength(1)
    expect(log.meals.dinner).toHaveLength(0)
    // breakfast: 150*2 + lunch: 200 = 500 cal; protein 5*2 + 40 = 50
    expect(log.totals.calories).toBe(500)
    expect(log.totals.protein).toBe(50)
  })

  it('keeps days separate', () => {
    addLogEntry(db, entry({ date: DATE }))
    addLogEntry(db, entry({ date: '2026-06-30' }))
    expect(getDailyLog(db, 1, DATE).totals.calories).toBe(150)
  })

  it('exposes the profile goals on the daily log', () => {
    updateProfile(db, 1, {
      goals: { calGoal: 1800, proteinGoal: 120, carbsGoal: null, fatGoal: null }
    })
    const log = getDailyLog(db, 1, DATE)
    expect(log.goals).toEqual({ calories: 1800, protein: 120, carbs: null, fat: null })
  })

  it('rescales totals when an entry amount is edited', () => {
    const id = addLogEntry(db, entry({ amount: 1, baseCalories: 100, baseProtein: 10 }))
    expect(getDailyLog(db, 1, DATE).totals.calories).toBe(100)
    updateLogEntry(db, id, { amount: 2.5 })
    const log = getDailyLog(db, 1, DATE)
    expect(log.totals.calories).toBe(250)
    expect(log.totals.protein).toBe(25)
  })

  it('removes a deleted entry from the day', () => {
    const id = addLogEntry(db, entry())
    deleteLogEntry(db, id)
    expect(getDailyLog(db, 1, DATE).meals.breakfast).toHaveLength(0)
  })

  it('survives db.export() running after each write (last_insert_rowid reset)', () => {
    const originalRun = db.run.bind(db)
    // @ts-expect-error mirror the app's persistence wrapper
    db.run = (...args) => {
      const result = originalRun(...args)
      db.export()
      return result
    }
    const id = addLogEntry(db, entry())
    expect(id).toBeGreaterThan(0)
    expect(getDailyLog(db, 1, DATE).meals.breakfast).toHaveLength(1)
  })
})

describe('computeTotals', () => {
  it('sums per-unit macros times amount', () => {
    const entries: LogEntry[] = [
      {
        id: 1,
        mealType: 'breakfast',
        name: 'A',
        brand: null,
        amount: 1.5,
        unit: '100g',
        baseCalories: 100,
        baseProtein: 8,
        baseCarbs: 4,
        baseFat: 2,
        barcode: null,
        source: 'search'
      },
      {
        id: 2,
        mealType: 'snack',
        name: 'B',
        brand: null,
        amount: 2,
        unit: 'serving',
        baseCalories: 50,
        baseProtein: 1,
        baseCarbs: 10,
        baseFat: 0,
        barcode: null,
        source: 'manual'
      }
    ]
    expect(computeTotals(entries)).toEqual({ calories: 250, protein: 14, carbs: 26, fat: 3 })
  })
})

describe('deleteProfile', () => {
  it('cascades and removes the profile and its log', () => {
    ensureDefaultProfile(db)
    const alex = addProfile(db, 'Alex')
    addLogEntry(db, entry({ profileId: alex }))
    addLogEntry(db, entry({ profileId: 1 }))
    deleteProfile(db, alex)
    expect(getProfiles(db).some((p) => p.id === alex)).toBe(false)
    expect(getDailyLog(db, alex, DATE).meals.breakfast).toHaveLength(0)
    // the other profile's log is untouched
    expect(getDailyLog(db, 1, DATE).meals.breakfast).toHaveLength(1)
  })
})
