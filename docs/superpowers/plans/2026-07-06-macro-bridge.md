# Plan → Tracker Macro Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estimated macros per serving on every recipe (from parsed ingredients), and a one-tap "log the planned meal" card in the tracker's Add Food modal.

**Architecture:** Pure estimator (`src/shared/macro-estimator.ts`) converts ingredient quantities to grams (unit table + typical count-weights) and applies caller-supplied per-100g matches. Matching (`src/renderer/data/macroEstimate.ts`) tries bundled staples, then the AU-first `/api/food-search` proxy. Summary scalars persist on `recipes` (additive columns); auto-computed after save, recomputable from the detail page. The tracker maps viewed date → weekday → plan slot and hands the modal a ready-to-log `planned` FoodItem. Spec: `docs/superpowers/specs/2026-07-06-macro-bridge-design.md`.

**Tech Stack:** TypeScript, Supabase, React, vitest.

**Conventions:** Repo root `recipe-vault/`. Branch `feat/macro-bridge`. TDD for the pure/data modules; UI compiler-verified + live-verified post-deploy.

---

### Task 0: Branch
- [ ] `git checkout -b feat/macro-bridge`

### Task 1: Types + schema

**Files:** Modify `src/shared/types.ts`, `supabase/schema.sql`.

- [ ] **1.1** In `types.ts`, after the `RecipeSummary` interface add:

```ts
/** Per-100g macro values used by the estimator. */
export interface Per100g {
  calories: number
  protein: number
  carbs: number
  fat: number
}

/** Stored per-serving macro estimate summary (best guess from parsed ingredients). */
export interface RecipeEstimate {
  calories: number
  protein: number
  carbs: number
  fat: number
  matched: number
  total: number
  assumedServings: boolean
}
```

Add `est: RecipeEstimate | null` to BOTH `Recipe` and `RecipeSummary`.
Change `FoodItem.source` to `'staple' | 'search' | 'barcode' | 'manual' | 'plan'`.

- [ ] **1.2** In `schema.sql`, directly after the recipes create-table block add:

```sql
-- Macro-estimate summary (computed client-side from parsed ingredients; per serving).
-- Guarded adds so re-runs are no-ops.
alter table public.recipes add column if not exists est_cal_serve     real;
alter table public.recipes add column if not exists est_protein_serve real;
alter table public.recipes add column if not exists est_carbs_serve   real;
alter table public.recipes add column if not exists est_fat_serve     real;
alter table public.recipes add column if not exists est_matched       integer;
alter table public.recipes add column if not exists est_total         integer;
alter table public.recipes add column if not exists est_computed_at   timestamptz;
```

- [ ] **1.3** `npm run typecheck` (Recipe/RecipeSummary constructors in recipes.ts will fail — expected; fix in Task 4 by mapping `est`). If typecheck fails only there, proceed; commit types+schema together with Task 4. Otherwise commit now:
`git add src/shared/types.ts supabase/schema.sql && git commit -m "feat(types,schema): recipe macro-estimate columns + types"`

### Task 2: Pure estimator (TDD)

**Files:** Create `src/shared/macro-estimator.ts`; test `tests/macro-estimator.test.ts`.

- [ ] **2.1** Write failing tests:

```ts
import { describe, it, expect } from 'vitest'
import { ingredientGrams, estimateRecipeMacros } from '../src/shared/macro-estimator'
import type { RecipeIngredient, Per100g } from '../src/shared/types'

function ing(over: Partial<RecipeIngredient>): RecipeIngredient {
  return { position: 0, raw: '', quantity: null, quantityMax: null, unit: null, name: '', ...over }
}
const CHICKEN: Per100g = { calories: 165, protein: 31, carbs: 0, fat: 3.6 }

describe('ingredientGrams', () => {
  it('converts canonical units', () => {
    expect(ingredientGrams(ing({ quantity: 600, unit: 'g' }), null)).toBe(600)
    expect(ingredientGrams(ing({ quantity: 2, unit: 'tbsp' }), null)).toBe(30)
    expect(ingredientGrams(ing({ quantity: 1, unit: 'cup' }), null)).toBe(240)
    expect(ingredientGrams(ing({ quantity: 1, unit: 'lb' }), null)).toBeCloseTo(453.6)
  })
  it('uses the range midpoint', () => {
    expect(ingredientGrams(ing({ quantity: 1, quantityMax: 3, unit: 'tsp' }), null)).toBe(10)
  })
  it('uses typical weights for unit-less counts', () => {
    expect(ingredientGrams(ing({ quantity: 2, name: 'large eggs' }), null)).toBe(100)
    expect(ingredientGrams(ing({ quantity: 1, name: 'brown onion, diced' }), null)).toBe(150)
  })
  it('falls back to the matched staple serving grams, else null', () => {
    expect(ingredientGrams(ing({ quantity: 2, name: 'weetbix' }), 17)).toBe(34)
    expect(ingredientGrams(ing({ quantity: 1, name: 'mystery item' }), null)).toBeNull()
    expect(ingredientGrams(ing({ name: 'salt & pepper' }), null)).toBeNull()
  })
})

describe('estimateRecipeMacros', () => {
  it('sums matched ingredients per serving and counts matches', () => {
    const ings = [
      ing({ quantity: 400, unit: 'g', name: 'chicken thigh' }),
      ing({ name: 'salt & pepper' })
    ]
    const { estimate, detail } = estimateRecipeMacros(ings, 2, [
      { per100g: CHICKEN, servingGrams: null },
      null
    ])
    expect(estimate.calories).toBe(330) // 165 × 4 / 2
    expect(estimate.protein).toBe(62)
    expect(estimate.matched).toBe(1)
    expect(estimate.total).toBe(2)
    expect(estimate.assumedServings).toBe(false)
    expect(detail[0]).toMatchObject({ matched: true, grams: 400 })
    expect(detail[1]).toMatchObject({ matched: false })
  })
  it('assumes 4 servings when unset and flags it', () => {
    const { estimate } = estimateRecipeMacros(
      [ing({ quantity: 400, unit: 'g', name: 'chicken' })],
      null,
      [{ per100g: CHICKEN, servingGrams: null }]
    )
    expect(estimate.calories).toBe(165) // 165 × 4 / 4
    expect(estimate.assumedServings).toBe(true)
  })
  it('does not count an ingredient whose grams are unknown even if matched', () => {
    const { estimate } = estimateRecipeMacros(
      [ing({ quantity: 1, name: 'mystery item' })],
      2,
      [{ per100g: CHICKEN, servingGrams: null }]
    )
    expect(estimate.matched).toBe(0)
    expect(estimate.calories).toBe(0)
  })
})
```

- [ ] **2.2** Run — expect FAIL (module missing).
- [ ] **2.3** Implement `src/shared/macro-estimator.ts`:

```ts
import type { Per100g, RecipeEstimate, RecipeIngredient } from './types'

// Canonical parser units → grams (ml treated as ≈ g; coarse where density varies —
// the whole estimate is a labelled best guess).
const UNIT_GRAMS: Record<string, number> = {
  g: 1, kg: 1000, ml: 1, l: 1000,
  tsp: 5, tbsp: 15, cup: 240, oz: 28.35, lb: 453.6,
  clove: 3, can: 400, tin: 400, slice: 25, pinch: 0.3,
  handful: 30, pack: 250, jar: 300, bottle: 500,
  bunch: 100, sprig: 2, stick: 50, knob: 15
}

// Typical whole-item weights for unit-less counts ("2 eggs", "1 onion").
// Multi-word keys first so "chicken breast" wins over any plain "chicken" rule.
const TYPICAL_WEIGHTS: [string, number][] = [
  ['chicken breast', 250], ['chicken thigh', 100], ['spring onion', 15],
  ['egg', 50], ['onion', 150], ['potato', 200], ['carrot', 60],
  ['tomato', 120], ['capsicum', 150], ['zucchini', 200], ['avocado', 150],
  ['banana', 118], ['apple', 180], ['sausage', 70], ['bacon', 30],
  ['tortilla', 60], ['wrap', 60], ['roll', 60], ['garlic', 3],
  ['chilli', 15], ['lime', 45], ['lemon', 60], ['cucumber', 250], ['celery', 40]
]

export interface EstimateDetail {
  name: string
  grams: number | null
  matched: boolean
  calories: number
}

/** Grams for one ingredient, or null when honestly unknown (then it's skipped). */
export function ingredientGrams(
  ing: RecipeIngredient,
  stapleServingGrams: number | null
): number | null {
  const qty =
    ing.quantity === null
      ? null
      : ing.quantityMax !== null
        ? (ing.quantity + ing.quantityMax) / 2
        : ing.quantity
  if (qty === null) return null
  if (ing.unit) return UNIT_GRAMS[ing.unit] !== undefined ? qty * UNIT_GRAMS[ing.unit] : null
  const lower = ing.name.toLowerCase()
  const hit = TYPICAL_WEIGHTS.find(([k]) => lower.includes(k))
  if (hit) return qty * hit[1]
  if (stapleServingGrams !== null) return qty * stapleServingGrams
  return null
}

/**
 * Pure per-serving estimate: matching is the caller's job (one per-100g entry
 * per ingredient, null = no match). servings null → assume 4, flagged.
 */
export function estimateRecipeMacros(
  ingredients: RecipeIngredient[],
  servings: number | null,
  matches: ({ per100g: Per100g; servingGrams: number | null } | null)[]
): { estimate: RecipeEstimate; detail: EstimateDetail[] } {
  let cal = 0
  let pro = 0
  let carb = 0
  let fat = 0
  let matched = 0
  const detail: EstimateDetail[] = ingredients.map((ing, i) => {
    const m = matches[i]
    const grams = ingredientGrams(ing, m?.servingGrams ?? null)
    if (!m || grams === null) return { name: ing.name, grams, matched: false, calories: 0 }
    matched++
    const f = grams / 100
    cal += m.per100g.calories * f
    pro += m.per100g.protein * f
    carb += m.per100g.carbs * f
    fat += m.per100g.fat * f
    return { name: ing.name, grams, matched: true, calories: Math.round(m.per100g.calories * f) }
  })
  const serves = servings ?? 4
  const r1 = (n: number): number => Math.round(n * 10) / 10
  return {
    estimate: {
      calories: Math.round(cal / serves),
      protein: r1(pro / serves),
      carbs: r1(carb / serves),
      fat: r1(fat / serves),
      matched,
      total: ingredients.length,
      assumedServings: servings === null
    },
    detail
  }
}
```

- [ ] **2.4** Run — expect PASS (7 tests).
- [ ] **2.5** Commit: `feat(estimator): pure ingredient->grams->per-serving macro estimator`

### Task 3: Staple lookup + matching data layer (TDD)

**Files:** Modify `src/shared/nutrition.ts`, `src/renderer/data/foods.ts` (export endpoint); create `src/renderer/data/macroEstimate.ts`; test `tests/data-macro-estimate.test.ts`.

- [ ] **3.1** In `nutrition.ts` add (after `searchStaples`):

```ts
/** Per-100g staple lookup for the macro estimator: shortest staple whose name
 *  contains — or is contained by — the query wins ("chicken thighs" → "Chicken thigh"). */
export function staplePer100g(
  name: string
): { per100g: Per100g; servingGrams: number } | null {
  const q = name.trim().toLowerCase()
  if (!q) return null
  const hits = STAPLES.filter((s) => {
    const n = s.name.toLowerCase()
    return n.includes(q) || q.includes(n)
  }).sort((a, b) => a.name.length - b.name.length)
  return hits[0] ? { per100g: hits[0].per100g, servingGrams: hits[0].serving.grams } : null
}
```

(import `Per100g` from `./types`.)

- [ ] **3.2** In `foods.ts`, export the endpoint: `export const FOOD_SEARCH_ENDPOINT = …` (same expression).

- [ ] **3.3** Failing tests `tests/data-macro-estimate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeRecipeEstimate, saveRecipeEstimate } from '../src/renderer/data/macroEstimate'
import type { Recipe } from '../src/shared/types'

const state = vi.hoisted(() => ({
  updated: [] as { patch: Record<string, unknown>; id: number }[]
}))
vi.mock('../src/renderer/data/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_c: string, id: number) => {
          state.updated.push({ patch, id })
          return Promise.resolve({ error: null })
        }
      })
    })
  }
}))

function recipe(ingredients: Recipe['ingredients'], servings: number | null): Recipe {
  return {
    id: 1, ownerId: 'u', title: 'T', sourceUrl: null, imageUrl: null, description: '',
    servings, prepMin: null, cookMin: null, totalMin: null, createdAt: '', est: null,
    ingredients, steps: []
  }
}
const ing = (name: string, quantity: number | null, unit: string | null) => ({
  position: 0, raw: '', quantity, quantityMax: null, unit, name
})

beforeEach(() => { state.updated = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('computeRecipeEstimate', () => {
  it('matches staples offline without any fetch', async () => {
    let fetches = 0
    vi.stubGlobal('fetch', async () => { fetches++; throw new Error('offline') })
    // "Chicken thigh" is a bundled staple
    const r = recipe([ing('chicken thighs', 600, 'g')], 2)
    const { estimate } = await computeRecipeEstimate(r)
    expect(estimate.matched).toBe(1)
    expect(estimate.calories).toBeGreaterThan(0)
    expect(fetches).toBe(0)
  })
  it('falls back to the proxy per-100g nutriments', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        products: [
          { nutriments: {} }, // first hit unusable → skipped
          { nutriments: { 'energy-kcal_100g': 90, proteins_100g: 4, carbohydrates_100g: 12, fat_100g: 2 } }
        ]
      })
    }))
    const r = recipe([ing('xylophone berries', 200, 'g')], 2)
    const { estimate } = await computeRecipeEstimate(r)
    expect(estimate.matched).toBe(1)
    expect(estimate.calories).toBe(90) // 90 × 2 / 2
  })
  it('marks unmatched when nothing knows the ingredient', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ ok: true, products: [] }) }))
    const { estimate } = await computeRecipeEstimate(recipe([ing('xylophone berries', 1, null)], 2))
    expect(estimate.matched).toBe(0)
  })
})

describe('saveRecipeEstimate', () => {
  it('writes the summary columns', async () => {
    await saveRecipeEstimate(7, {
      calories: 620, protein: 42, carbs: 58, fat: 18,
      matched: 10, total: 12, assumedServings: false
    })
    expect(state.updated).toHaveLength(1)
    expect(state.updated[0].id).toBe(7)
    expect(state.updated[0].patch).toMatchObject({
      est_cal_serve: 620, est_protein_serve: 42, est_carbs_serve: 58,
      est_fat_serve: 18, est_matched: 10, est_total: 12
    })
    expect(typeof state.updated[0].patch.est_computed_at).toBe('string')
  })
})
```

- [ ] **3.4** Run — expect FAIL. Implement `src/renderer/data/macroEstimate.ts`:

```ts
import { supabase } from './supabase'
import { FOOD_SEARCH_ENDPOINT } from './foods'
import { getRecipe } from './recipes'
import { staplePer100g } from '../../shared/nutrition'
import { estimateRecipeMacros } from '../../shared/macro-estimator'
import type { EstimateDetail } from '../../shared/macro-estimator'
import type { Per100g, Recipe, RecipeEstimate } from '../../shared/types'

type Match = { per100g: Per100g; servingGrams: number | null } | null

/** "boneless chicken thighs (skin off), diced" → "boneless chicken thighs" */
function cleanName(name: string): string {
  return name.replace(/\(.*?\)/g, '').split(',')[0].trim()
}

async function lookupPer100g(name: string): Promise<Match> {
  const q = cleanName(name)
  if (!q) return null
  const staple = staplePer100g(q)
  if (staple) return staple
  try {
    const res = await fetch(`${FOOD_SEARCH_ENDPOINT}?q=${encodeURIComponent(q)}`)
    if (!res.ok) return null
    const data = (await res.json()) as {
      ok?: boolean
      products?: { nutriments?: Record<string, number | string> }[]
    }
    if (!data.ok) return null
    for (const p of data.products ?? []) {
      const n = p.nutriments
      const cal = Number(n?.['energy-kcal_100g'])
      if (n && Number.isFinite(cal)) {
        return {
          per100g: {
            calories: cal,
            protein: Number(n.proteins_100g) || 0,
            carbs: Number(n.carbohydrates_100g) || 0,
            fat: Number(n.fat_100g) || 0
          },
          servingGrams: null
        }
      }
    }
  } catch {
    // offline — staples may still have matched other ingredients
  }
  return null
}

/** Match every ingredient (staples → proxy, sequential) and run the pure estimator. */
export async function computeRecipeEstimate(
  recipe: Recipe
): Promise<{ estimate: RecipeEstimate; detail: EstimateDetail[] }> {
  const matches: Match[] = []
  for (const ing of recipe.ingredients) matches.push(await lookupPer100g(ing.name))
  return estimateRecipeMacros(recipe.ingredients, recipe.servings, matches)
}

export async function saveRecipeEstimate(id: number, e: RecipeEstimate): Promise<void> {
  const { error } = await supabase
    .from('recipes')
    .update({
      est_cal_serve: e.calories,
      est_protein_serve: e.protein,
      est_carbs_serve: e.carbs,
      est_fat_serve: e.fat,
      est_matched: e.matched,
      est_total: e.total,
      est_computed_at: new Date().toISOString()
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** Fire-and-forget after save/import: compute + persist, silently tolerant. */
export async function estimateAndSave(recipeId: number): Promise<void> {
  try {
    const recipe = await getRecipe(recipeId)
    if (!recipe || recipe.ingredients.length === 0) return
    const { estimate } = await computeRecipeEstimate(recipe)
    await saveRecipeEstimate(recipeId, estimate)
  } catch {
    // best-effort — the detail page's Estimate button always recovers
  }
}
```

- [ ] **3.5** Run — expect PASS (4 tests). NOTE: the first test assumes a "Chicken thigh" staple exists in `common-foods.json` — verify with grep first; if absent, pick another staple.
- [ ] **3.6** Commit: `feat(foods): ingredient->per-100g matching + estimate persistence`

### Task 4: recipes.ts mapping

**Files:** Modify `src/renderer/data/recipes.ts`.

- [ ] **4.1** Add a small mapper + wire it into both readers:

```ts
function mapEst(r: {
  est_cal_serve: number | null
  est_protein_serve: number | null
  est_carbs_serve: number | null
  est_fat_serve: number | null
  est_matched: number | null
  est_total: number | null
  est_computed_at: string | null
  servings?: number | null
}): RecipeEstimate | null {
  if (r.est_computed_at === null || r.est_cal_serve === null) return null
  return {
    calories: r.est_cal_serve,
    protein: r.est_protein_serve ?? 0,
    carbs: r.est_carbs_serve ?? 0,
    fat: r.est_fat_serve ?? 0,
    matched: r.est_matched ?? 0,
    total: r.est_total ?? 0,
    assumedServings: (r.servings ?? null) === null
  }
}
```

`listRecipes` select becomes
`'id, owner_id, title, image_url, total_min, servings, est_cal_serve, est_protein_serve, est_carbs_serve, est_fat_serve, est_matched, est_total, est_computed_at'`
and each summary gains `est: mapEst(r)`. `getRecipe` (select `*`) gains `est: mapEst(r)`.

- [ ] **4.2** `npm run typecheck` + full `npx vitest run` green (fix any `est` omissions the compiler finds — e.g. test fixtures).
- [ ] **4.3** Commit (include Task 1 files if still uncommitted): `feat(recipes): map stored macro estimates`

### Task 5: Recipe UI + auto-compute

**Files:** Modify `src/renderer/pages/RecipeDetailPage.tsx`, `src/renderer/pages/LibraryPage.tsx`, `src/renderer/components/RecipeReviewForm.tsx`, `src/renderer/styles.css`.

- [ ] **5.1** Detail page: local state `est` (initialised from `recipe.est`), `detail` (in-session breakdown), `estimating`. Below `detail__chips` insert:

```tsx
<div className="est-block">
  {est ? (
    <>
      <span className="est-block__line">
        ≈ {Math.round(est.calories)} kcal · P {est.protein} / C {est.carbs} / F {est.fat} g per
        serve{est.assumedServings ? ' (assumes 4 serves)' : ''}
      </span>
      <span className="est-block__meta">
        best guess — matched {est.matched} of {est.total} ingredients
      </span>
    </>
  ) : (
    <span className="est-block__meta">No macro estimate yet.</span>
  )}
  {me && recipe.ownerId === me.id && (
    <button className="link-btn" onClick={recalc} disabled={estimating}>
      {estimating ? 'Estimating…' : est ? '♻️ Recalculate' : 'Estimate macros'}
    </button>
  )}
  {detail && (
    <ul className="est-breakdown">
      {detail.map((d, i) => (
        <li key={i} className={d.matched ? '' : 'est-breakdown__miss'}>
          {d.matched ? `${d.name} — ${Math.round(d.grams ?? 0)} g · ${d.calories} kcal` : `${d.name} — not matched`}
        </li>
      ))}
    </ul>
  )}
</div>
```

with

```ts
const recalc = async (): Promise<void> => {
  if (!recipe) return
  setEstimating(true)
  try {
    const out = await computeRecipeEstimate(recipe)
    await saveRecipeEstimate(recipe.id, out.estimate)
    setEst(out.estimate)
    setDetail(out.detail)
  } finally {
    setEstimating(false)
  }
}
```

(Estimate writes are gated to the owner — matches the RLS owner-update policy.)

- [ ] **5.2** Library card: after the time chip add

```tsx
{r.est && <span className="recipe-card__time">≈ {Math.round(r.est.calories)} kcal/serve</span>}
```

- [ ] **5.3** RecipeReviewForm: import `estimateAndSave` and fire it post-save:

```ts
const id = await saveRecipe(draft)
void estimateAndSave(id) // background best-guess macros; detail page can redo it
props.onSaved(id)
```

- [ ] **5.4** styles.css (after the `.detail__chips` rules):

```css
/* Macro estimate (best guess) on the recipe detail page */
.est-block {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.est-block__line {
  font-size: 13px;
  font-weight: 600;
}
.est-block__meta {
  font-size: 11px;
  color: var(--text-muted);
}
.est-breakdown {
  list-style: none;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.est-breakdown__miss {
  color: var(--text-muted);
  font-style: italic;
}
```

- [ ] **5.5** Typecheck + suite green; commit: `feat(recipes): macro estimate on detail + cards, auto-compute on save`

### Task 6: Planned-meal card in the tracker

**Files:** Modify `src/renderer/pages/MacroTrackerPage.tsx`, `src/renderer/components/AddFoodModal.tsx`, `src/renderer/App.tsx`, `src/renderer/styles.css`.

- [ ] **6.1** App passes recipes: `<MacroTrackerPage recipes={recipes.recipes} />`; the page accepts `props: { recipes: RecipeSummary[] }`.

- [ ] **6.2** MacroTrackerPage: load the current user's plan (`getMealPlan(current.id)` + `onTableChange(['meal_plan'], …)`, same stale-guard pattern as `reloadLog`). Compute the planned item for the meal being added:

```ts
const plannedFor = (meal: MealType): FoodItem | null => {
  if (meal === 'snack' || !plan) return null
  const day = DAY_ORDER_FOR_DATE(date) // (new Date(date+'T00:00:00').getDay()+6)%7 → DAYS index
  const slot = plan.find((e) => e.day === DAYS[day] && e.meal === meal)
  if (!slot || slot.recipeId === null) return null
  const r = props.recipes.find((x) => x.id === slot.recipeId)
  if (!r || !r.est) return null
  return {
    name: r.title, brand: null, barcode: null,
    servingDesc: `planned ${MEAL_LABEL[meal].toLowerCase()} · best-guess macros`,
    unit: 'serving',
    calories: r.est.calories, protein: r.est.protein, carbs: r.est.carbs, fat: r.est.fat,
    source: 'plan'
  }
}
```

Pass it when opening the modal: `<AddFoodModal … planned={plannedFor(adding)} />`.

- [ ] **6.3** AddFoodModal: new optional prop `planned?: FoodItem | null`. At the top of the search tab (before the search row):

```tsx
{props.planned && (
  <button className="food-result food-result--planned" onClick={() => setSelected(props.planned!)}>
    <span className="food-result__name">📋 Planned: {props.planned.name}</span>
    <span className="food-result__macros">{macroLine(props.planned)} — tap to log</span>
  </button>
)}
```

- [ ] **6.4** styles.css:

```css
.food-result--planned {
  border: 1.5px solid var(--accent);
  background: var(--accent-tint);
  border-radius: var(--radius);
  margin-bottom: 10px;
  width: 100%;
}
```

- [ ] **6.5** Typecheck + suite green; commit: `feat(tracker): one-tap log of the planned meal`

### Task 7: Verify + finish

- [ ] **7.1** `npm run typecheck` · `npx vitest run` · `npm run lint` (0 errors) · `npm run build:web` · `npx electron-vite build`.
- [ ] **7.2** ff-merge → main. **Schema hand-off BEFORE push** (additive `alter table` adds — expect only the usual policy-drop warnings on re-run). Push after Harrison confirms → Vercel deploy.
- [ ] **7.3** Post-deploy: open a recipe → Estimate macros → sane numbers + breakdown; plan a dinner → tracker → Add food (dinner) → planned card appears → log it.
