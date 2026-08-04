import { supabase } from './supabase'
import { myId } from './users'
import { parsePlanPrefs } from '../../shared/plan-prefs'
import type { PlanPrefs } from '../../shared/plan-prefs'

/**
 * The Generate-week wizard's remembered answers, or null if this person has never
 * finished the wizard. That distinction is the whole point: stored answers let the sheet
 * open straight on the review step, but a first-timer must actually be asked the
 * questions — so "no row yet" can't quietly resolve to the defaults.
 *
 * Stored on the profile rather than in localStorage so the phone and the desktop app
 * agree; being one tap from a week shouldn't depend on which device you opened.
 */
export async function getPlanPrefs(): Promise<PlanPrefs | null> {
  const id = await myId()
  const { data, error } = await supabase
    .from('profiles')
    .select('plan_prefs')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const raw = data?.plan_prefs ?? null
  return raw === null ? null : parsePlanPrefs(raw)
}

export async function savePlanPrefs(prefs: PlanPrefs): Promise<void> {
  const id = await myId()
  const { error } = await supabase.from('profiles').upsert({ id, plan_prefs: prefs })
  if (error) throw new Error(error.message)
}
