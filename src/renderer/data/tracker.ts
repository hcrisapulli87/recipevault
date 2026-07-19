import { supabase } from './supabase'
import { computeTotals } from '../../shared/tracker-logic'
import { MEAL_TYPES } from '../../shared/types'
import type { DailyLog, DailyTotals, LogEntry, MealType, ProfileGoals } from '../../shared/types'

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

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()
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
  const { error: ue } = await supabase.from('profiles').upsert({ id: user.id, display_name: name })
  if (ue) throw new Error(ue.message)
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

/** Read-only goals for any household member (no auto-create — that's getProfile's job). */
async function getGoalsOf(ownerId: string): Promise<ProfileGoals> {
  const { data, error } = await supabase
    .from('profiles')
    .select('cal_goal, protein_goal, carbs_goal, fat_goal')
    .eq('id', ownerId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return {
    calGoal: data?.cal_goal ?? null,
    proteinGoal: data?.protein_goal ?? null,
    carbsGoal: data?.carbs_goal ?? null,
    fatGoal: data?.fat_goal ?? null
  }
}

/**
 * One day's log for one household member. Policies allow reading both users'
 * logs, so scoping is explicit — pass the id from the Me/partner switcher.
 * `isMe` routes through getProfile so a first-time user still gets their
 * profiles row auto-created; the partner's goals are read plainly.
 */
export async function getDailyLog(
  date: string,
  owner: { id: string; isMe: boolean }
): Promise<DailyLog> {
  const goals: ProfileGoals = owner.isMe
    ? await getProfile().then((p) => ({
        calGoal: p.calGoal,
        proteinGoal: p.proteinGoal,
        carbsGoal: p.carbsGoal,
        fatGoal: p.fatGoal
      }))
    : await getGoalsOf(owner.id)
  const { data, error } = await supabase
    .from('food_log')
    .select(
      'id, meal_type, name, brand, amount, unit, base_calories, base_protein, base_carbs, base_fat, barcode, source'
    )
    .eq('owner_id', owner.id)
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
      calories: goals.calGoal,
      protein: goals.proteinGoal,
      carbs: goals.carbsGoal,
      fat: goals.fatGoal
    }
  }
}

/** Per-day totals over a date range (inclusive), for the Trends view.
 *  One query; aggregation client-side. RLS household-read covers partner ids. */
export async function getDailyTotalsRange(
  ownerId: string,
  from: string,
  to: string
): Promise<Map<string, DailyTotals>> {
  const { data, error } = await supabase
    .from('food_log')
    .select('log_date, amount, base_calories, base_protein, base_carbs, base_fat')
    .eq('owner_id', ownerId)
    .gte('log_date', from)
    .lte('log_date', to)
  if (error) throw new Error(error.message)
  const map = new Map<string, DailyTotals>()
  for (const r of data ?? []) {
    const t = map.get(r.log_date) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 }
    t.calories += r.base_calories * r.amount
    t.protein += r.base_protein * r.amount
    t.carbs += r.base_carbs * r.amount
    t.fat += r.base_fat * r.amount
    map.set(r.log_date, t)
  }
  return map
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
