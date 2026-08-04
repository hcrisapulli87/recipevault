import { CUISINES, DIET_TAGS, PLAN_MEALS } from './types'
import type { Cuisine, DietTag, PlanMeal } from './types'
import { DEFAULT_GENERATE_OPTIONS } from './plan-generator'
import type { GenerateOptions, LeftoverAppetite } from './plan-generator'

/**
 * The Generate-week wizard's answers, remembered per person in `profiles.plan_prefs`.
 *
 * It is exactly `GenerateOptions` minus the two fields that belong to a single run rather
 * than to a preference: `locked` (which slots you pinned this time) and `seed` (which
 * shuffle you happened to land on).
 */
export type PlanPrefs = Omit<GenerateOptions, 'locked' | 'seed'>

export const DEFAULT_PLAN_PREFS: PlanPrefs = {
  diets: DEFAULT_GENERATE_OPTIONS.diets,
  cuisines: DEFAULT_GENERATE_OPTIONS.cuisines,
  cookNights: DEFAULT_GENERATE_OPTIONS.cookNights,
  servingsPerMeal: DEFAULT_GENERATE_OPTIONS.servingsPerMeal,
  leftoverAppetite: DEFAULT_GENERATE_OPTIONS.leftoverAppetite,
  slots: DEFAULT_GENERATE_OPTIONS.slots
}

const APPETITES: LeftoverAppetite[] = ['low', 'medium', 'high']

/** Keep only the members of `allowed` — drops a cuisine or diet tag that has since been
 *  renamed or removed from the catalog rather than feeding it to the generator. */
function keepKnown<T>(value: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((v): v is T => allowed.includes(v as T))
}

function clampInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * Read stored prefs back, field by field, falling back to the default for anything
 * missing or unrecognised. The column is free-form jsonb written by an older version of
 * this same client, so it is treated as untrusted input: a new question added later needs
 * no migration, and a stale value can never crash the wizard.
 */
export function parsePlanPrefs(raw: unknown): PlanPrefs {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_PLAN_PREFS }
  const o = raw as Record<string, unknown>
  const slots = keepKnown<PlanMeal>(o.slots, PLAN_MEALS)
  return {
    diets: keepKnown<DietTag>(o.diets, DIET_TAGS) ?? DEFAULT_PLAN_PREFS.diets,
    cuisines: keepKnown<Cuisine>(o.cuisines, CUISINES) ?? DEFAULT_PLAN_PREFS.cuisines,
    cookNights: clampInt(o.cookNights, 1, 7) ?? DEFAULT_PLAN_PREFS.cookNights,
    servingsPerMeal: clampInt(o.servingsPerMeal, 1, 8) ?? DEFAULT_PLAN_PREFS.servingsPerMeal,
    leftoverAppetite: APPETITES.includes(o.leftoverAppetite as LeftoverAppetite)
      ? (o.leftoverAppetite as LeftoverAppetite)
      : DEFAULT_PLAN_PREFS.leftoverAppetite,
    // An empty slots array would generate an empty week, so treat it as "never answered".
    slots: slots && slots.length > 0 ? slots : DEFAULT_PLAN_PREFS.slots
  }
}
