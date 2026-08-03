import { DAYS, PLAN_MEALS } from './types'
import type { Cuisine, Day, DietTag, MealPlanEntry, PlanMeal, RecipeSummary } from './types'

/**
 * The week generator: pure, deterministic, no I/O.
 *
 * The idea it encodes is how people actually eat — you cook three or four nights and
 * live off the batches in between. So the generator picks a handful of COOK NIGHTS and
 * then chains each batch forward into later slots as leftovers. A leftover slot carries
 * the same `recipeId` as its cook night, which is what lets groceries count the batch
 * once and the tracker log identical macros.
 *
 * Two hard safety rules, both driven by hand-authored catalog metadata: a leftover never
 * sits further from its cook night than the recipe's `keepsDays`, and a `fresh-only`
 * recipe is never chained at all.
 */

export type LeftoverAppetite = 'low' | 'medium' | 'high'

export interface GenerateOptions {
  /** Empty = no diet filter. Otherwise a recipe must carry at least one of these tags. */
  diets: DietTag[]
  /** Empty = all cuisines. Applies to COOK NIGHTS only — see `eligible` below. */
  cuisines: Cuisine[]
  cookNights: number
  /** Serves per person-meal; drives `servingsPlanned` and therefore grocery scaling. */
  servingsPerMeal: number
  leftoverAppetite: LeftoverAppetite
  /** Which of breakfast/lunch/dinner to fill. */
  slots: PlanMeal[]
  /** Slots the user pinned. Copied through verbatim and never planned over. */
  locked: MealPlanEntry[]
  /** Reproducible "Regenerate": same seed, same week. */
  seed: number
}

export const DEFAULT_GENERATE_OPTIONS: GenerateOptions = {
  diets: [],
  cuisines: [],
  cookNights: 4,
  servingsPerMeal: 2,
  leftoverAppetite: 'medium',
  slots: [...PLAN_MEALS],
  locked: [],
  seed: 1
}

/** How many extra meals one batch may cover, beyond the cook night itself. */
const MAX_REPEATS: Record<LeftoverAppetite, number> = { low: 1, medium: 2, high: 3 }

/** How many distinct breakfasts to rotate. People repeat breakfast; variety is not a virtue here. */
const BREAKFAST_VARIETY = 3

// ── helpers ───────────────────────────────────────────────────────────────────

/** xorshift32. Inlined rather than pulled in as a dependency — it's five lines and the
 *  only thing we need from it is "same seed, same sequence". */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0x100000000
  }
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const slotKey = (day: Day, meal: PlanMeal): string => `${day}|${meal}`

function blankSlot(day: Day, meal: PlanMeal): MealPlanEntry {
  return {
    day,
    meal,
    recipeId: null,
    freeText: null,
    isLeftover: false,
    cookDay: null,
    servingsPlanned: null
  }
}

/**
 * Does this recipe suit this slot?
 *
 * The cuisine filter deliberately applies to cook nights only (`applyCuisine`). Cuisine
 * preference is a statement about dinner — filtering breakfasts and snacks by "Greek and
 * Italian" would just empty those slots, since porridge and a banana belong to no cuisine.
 */
function eligible(
  r: RecipeSummary,
  meal: PlanMeal,
  opts: GenerateOptions,
  applyCuisine: boolean
): boolean {
  if (!r.mealSlots.includes(meal)) return false
  if (opts.diets.length > 0 && !r.dietTags.some((t) => opts.diets.includes(t))) return false
  if (applyCuisine && opts.cuisines.length > 0) {
    if (r.cuisine === null || !opts.cuisines.includes(r.cuisine)) return false
  }
  return true
}

/**
 * Which days to cook on, spread as evenly as the week allows: 4 nights → Mon/Wed/Fri/Sat.
 * Days whose dinner slot is locked are skipped and replaced with the nearest free day, so
 * pinning "dinner at Mum's" on Wednesday shifts the cooking rather than costing a night.
 */
function chooseCookDays(count: number, lockedDinnerDays: Set<Day>): Day[] {
  const free = DAYS.filter((d) => !lockedDinnerDays.has(d))
  const n = Math.max(0, Math.min(free.length, Math.floor(count)))
  if (n === 0) return []

  const picked: Day[] = []
  const takenIdx = new Set<number>()
  for (let i = 0; i < n; i++) {
    let idx = Math.min(free.length - 1, Math.round((i * free.length) / n))
    // Rounding can collide on short weeks; walk to the next free index rather than
    // silently returning fewer nights than asked for.
    while (takenIdx.has(idx)) idx = (idx + 1) % free.length
    takenIdx.add(idx)
    picked.push(free[idx])
  }
  return picked.sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b))
}

// ── the generator ─────────────────────────────────────────────────────────────

export function generateWeek(
  catalog: RecipeSummary[],
  options: Partial<GenerateOptions> = {}
): MealPlanEntry[] {
  const opts: GenerateOptions = { ...DEFAULT_GENERATE_OPTIONS, ...options }
  const rng = makeRng(opts.seed)
  const byId = new Map(catalog.map((r) => [r.id, r]))

  // Day-major order, matching getMealPlan — the caller writes the whole array back.
  const week = DAYS.flatMap((day) => PLAN_MEALS.map((meal) => blankSlot(day, meal)))
  const bySlot = new Map(week.map((e) => [slotKey(e.day, e.meal), e]))

  const lockedKeys = new Set(opts.locked.map((l) => slotKey(l.day, l.meal)))
  for (const l of opts.locked) {
    const target = bySlot.get(slotKey(l.day, l.meal))
    if (target) Object.assign(target, l)
  }

  const isFree = (day: Day, meal: PlanMeal): boolean => {
    if (lockedKeys.has(slotKey(day, meal))) return false
    const e = bySlot.get(slotKey(day, meal))
    return e != null && e.recipeId === null && e.freeText === null
  }

  // ── 1. Cook nights ──────────────────────────────────────────────────────────
  const cookSlots: MealPlanEntry[] = []
  if (opts.slots.includes('dinner')) {
    const pool = shuffled(
      catalog.filter((r) => r.batchFriendly && eligible(r, 'dinner', opts, true)),
      rng
    )
    const lockedDinners = new Set(
      opts.locked.filter((l) => l.meal === 'dinner').map((l) => l.day)
    )
    const used = new Set<number>()
    const cookedCuisines: (Cuisine | null)[] = []
    let previous: RecipeSummary | null = null

    for (const day of chooseCookDays(opts.cookNights, lockedDinners)) {
      if (!isFree(day, 'dinner')) continue
      // Fall through a ladder of preferences rather than leaving the night empty. Only
      // avoiding the *immediately* previous cuisine still permits Italian-Greek-Italian-
      // Greek, which reads as a rut, so ask first for a cuisine the week hasn't cooked at
      // all. The last rung still refuses to cook the same dish twice running — repeating a
      // dish is what leftovers are for.
      const unused = (r: RecipeSummary): boolean => !used.has(r.id)
      const recent = cookedCuisines.slice(-2)
      const pick =
        pool.find((r) => unused(r) && r.cuisine !== null && !cookedCuisines.includes(r.cuisine)) ??
        pool.find((r) => unused(r) && !recent.includes(r.cuisine)) ??
        pool.find((r) => unused(r) && r.cuisine !== previous?.cuisine) ??
        pool.find(unused) ??
        pool.find((r) => r.id !== previous?.id)
      if (!pick) break

      const slot = bySlot.get(slotKey(day, 'dinner'))!
      slot.recipeId = pick.id
      used.add(pick.id)
      cookedCuisines.push(pick.cuisine)
      previous = pick
      cookSlots.push(slot)
    }
  }

  // ── 2. Chain each batch forward as leftovers ────────────────────────────────
  const maxRepeats = MAX_REPEATS[opts.leftoverAppetite]
  for (const night of cookSlots) {
    const r = byId.get(night.recipeId!)
    if (!r || r.reheat === 'fresh-only' || r.keepsDays < 1) continue

    const cookIdx = DAYS.indexOf(night.day)
    let placed = 0
    for (let offset = 1; offset <= r.keepsDays && placed < maxRepeats; offset++) {
      const dayIdx = cookIdx + offset
      if (dayIdx > 6) break
      const day = DAYS[dayIdx]
      // Lunch before dinner: "last night's dinner is today's lunch" is the pattern that
      // earns the most from a batch. Breakfast is never a leftover slot.
      for (const meal of ['lunch', 'dinner'] as PlanMeal[]) {
        if (placed >= maxRepeats) break
        if (!opts.slots.includes(meal) || !isFree(day, meal)) continue
        const slot = bySlot.get(slotKey(day, meal))!
        slot.recipeId = r.id
        slot.isLeftover = true
        slot.cookDay = night.day
        placed++
      }
    }
  }

  // ── 3. Fill the lunches leftovers didn't reach ──────────────────────────────
  if (opts.slots.includes('lunch')) {
    const pool = shuffled(
      catalog.filter((r) => eligible(r, 'lunch', opts, false)),
      rng
    ).sort((a, b) => effortRank(a) - effortRank(b)) // light lunches first
    let cursor = 0
    for (const day of DAYS) {
      if (!isFree(day, 'lunch') || pool.length === 0) continue
      const slot = bySlot.get(slotKey(day, 'lunch'))!
      slot.recipeId = pool[cursor % pool.length].id
      cursor++
    }
  }

  // ── 4. Rotate a couple of breakfasts ────────────────────────────────────────
  if (opts.slots.includes('breakfast')) {
    const pool = shuffled(
      catalog.filter((r) => eligible(r, 'breakfast', opts, false)),
      rng
    ).slice(0, BREAKFAST_VARIETY)
    let cursor = 0
    for (const day of DAYS) {
      if (!isFree(day, 'breakfast') || pool.length === 0) continue
      const slot = bySlot.get(slotKey(day, 'breakfast'))!
      slot.recipeId = pool[cursor % pool.length].id
      cursor++
    }
  }

  // ── 5. How much to cook ─────────────────────────────────────────────────────
  // Every non-leftover recipe slot gets a serving count, not just dinners: the grocery
  // preview scales each planned recipe by servingsPlanned / recipe.servings, so a lunch
  // that feeds nobody's leftovers still needs its own serve bought.
  for (const e of week) {
    if (e.recipeId === null || e.isLeftover || lockedKeys.has(slotKey(e.day, e.meal))) continue
    const repeats = week.filter(
      (l) => l.isLeftover && l.cookDay === e.day && l.recipeId === e.recipeId
    ).length
    e.servingsPlanned = opts.servingsPerMeal * (1 + repeats)
  }

  return week
}

function effortRank(r: RecipeSummary): number {
  return r.effort === 'minimal' ? 0 : r.effort === 'easy' ? 1 : 2
}

/**
 * The label the Discord bot reads out of `meal_plan.meal_text`. Leftover slots must carry
 * one too — without it the bot's nightly post goes blank on every leftover night.
 */
export function planLabel(entry: MealPlanEntry, title: string | null): string | null {
  if (entry.freeText !== null) return entry.freeText
  if (title === null) return null
  return entry.isLeftover ? `Leftovers · ${title}` : title
}
