import { supabase } from './supabase'
import { myId } from './users'
import { parseBodyStats } from '../../shared/goal-calculator'
import type { BodyStats } from '../../shared/goal-calculator'

/** The goal calculator's remembered answers (sex, height, age, weight, activity, goal).
 *  On the profile rather than in localStorage so the phone and the desktop app agree. */
export async function getBodyStats(): Promise<BodyStats> {
  const id = await myId()
  const { data, error } = await supabase
    .from('profiles')
    .select('body_stats')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return parseBodyStats(data?.body_stats ?? null)
}

export async function saveBodyStats(stats: BodyStats): Promise<void> {
  const id = await myId()
  const { error } = await supabase.from('profiles').upsert({ id, body_stats: stats })
  if (error) throw new Error(error.message)
}
