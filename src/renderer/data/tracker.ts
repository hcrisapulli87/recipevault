import { supabase } from './supabase'
import { computeTotals } from '../../shared/tracker-logic'
import { MEAL_TYPES } from '../../shared/types'
import type { DailyLog, LogEntry, MealType, ProfileGoals } from '../../shared/types'

// Each signed-in user IS a profile (one profiles row keyed by auth.users.id). No switcher.
export interface TrackerProfile extends ProfileGoals {
  name: string
}

// A log entry to insert — owner_id is stamped by the column default (auth.uid()).
export interface NewLogEntry {
  date: string
  mealType: MealType
  name: string
  brand: string | null
  amount: number
  unit: string
  baseCalories: number
  baseProtein: number
  baseCarbs: number
  baseFat: number
  barcode: string | null
  source: string
}

function rowToLogEntry(r: {
  id: number
  meal_type: string
  name: string
  brand: string | null
  amount: number
  unit: string
  base_calories: number
  base_protein: number
  base_carbs: number
  base_fat: number
  barcode: string | null
  source: string
}): LogEntry {
  return {
    id: r.id,
    mealType: r.meal_type as MealType,
    name: r.name,
    brand: r.brand,
    amount: r.amount,
    unit: r.unit,
    baseCalories: r.base_calories,
    baseProtein: r.base_protein,
    baseCarbs: r.base_carbs,
    baseFat: r.base_fat,
    barcode: r.barcode,
    source: r.source
  }
}

async function requireUserId(): Promise<string> {
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  return user.id
}

/** Load the current user's profile, creating the row (with email as the name) on first call. */
export async function getProfile(): Promise<TrackerProfile> {
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
  if (error) throw new Error(error.message)

  if (data) {
    return {
      name: data.display_name ?? user.email ?? 'Me',
      calGoal: data.cal_goal,
      proteinGoal: data.protein_goal,
      carbsGoal: data.carbs_goal,
      fatGoal: data.fat_goal
    }
  }

  const name = user.email ?? 'Me'
  await supabase.from('profiles').upsert({ id: user.id, display_name: name })
  return { name, calGoal: null, proteinGoal: null, carbsGoal: null, fatGoal: null }
}

export async function updateProfile(patch: { name?: string; goals?: ProfileGoals }): Promise<void> {
  const id = await requireUserId()
  const update: Record<string, unknown> = { id }
  if (patch.name !== undefined) update.display_name = patch.name
  if (patch.goals) {
    update.cal_goal = patch.goals.calGoal
    update.protein_goal = patch.goals.proteinGoal
    update.carbs_goal = patch.goals.carbsGoal
    update.fat_goal = patch.goals.fatGoal
  }
  const { error } = await supabase.from('profiles').upsert(update)
  if (error) throw new Error(error.message)
}

export async function getDailyLog(date: string): Promise<DailyLog> {
  const profile = await getProfile()
  const { data, error } = await supabase
    .from('food_log')
    .select(
      'id, meal_type, name, brand, amount, unit, base_calories, base_protein, base_carbs, base_fat, barcode, source'
    )
    .eq('log_date', date)
    .order('id')
  if (error) throw new Error(error.message)

  const entries = (data ?? []).map(rowToLogEntry)
  const meals = Object.fromEntries(MEAL_TYPES.map((m) => [m, [] as LogEntry[]])) as Record<
    MealType,
    LogEntry[]
  >
  for (const e of entries) meals[e.mealType].push(e)

  return {
    date,
    meals,
    totals: computeTotals(entries),
    goals: {
      calories: profile.calGoal,
      protein: profile.proteinGoal,
      carbs: profile.carbsGoal,
      fat: profile.fatGoal
    }
  }
}

export async function addLogEntry(entry: NewLogEntry): Promise<void> {
  const { error } = await supabase.from('food_log').insert({
    log_date: entry.date,
    meal_type: entry.mealType,
    name: entry.name,
    brand: entry.brand,
    amount: entry.amount,
    unit: entry.unit,
    base_calories: entry.baseCalories,
    base_protein: entry.baseProtein,
    base_carbs: entry.baseCarbs,
    base_fat: entry.baseFat,
    barcode: entry.barcode,
    source: entry.source
  })
  if (error) throw new Error(error.message)
}

export async function updateLogEntry(id: number, amount: number): Promise<void> {
  const { error } = await supabase.from('food_log').update({ amount }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteLogEntry(id: number): Promise<void> {
  const { error } = await supabase.from('food_log').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
