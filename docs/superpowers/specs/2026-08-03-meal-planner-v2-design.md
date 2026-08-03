# Meal Planner v2 — catalog, generated weeks, leftovers, tracker bridge

Design agreed with Harrison, 2026-08-03.

## Problem

The planner is the weakest of RecipeVault's three pillars. `MealPlanPage.tsx` renders a
flat 7 × 3 grid of slots, each either free text or a recipe picked from the library. There
is no notion of leftovers, no way to generate a week, and no recipe metadata (cuisine,
diet, how well a dish keeps) to generate one from. The library holds only what Harrison
has personally imported, so on a fresh week there is nothing to plan *with*.

The tracker bridge is half-built and one-directional: `MacroTrackerPage.tsx` `plannedFor()`
surfaces today's planned recipe as a one-tap log, but there is no path from a plan slot to
the tracker.

## Outcome

The planner becomes the page you open on Sunday. Pick a diet and some cuisines, hit
Generate, and get a realistic week that cooks three or four nights and eats the rest as
leftovers — groceries counting each batch once, every slot loggable straight into the
tracker.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Recipe pool | ~170 recipes authored by us, research-informed, shipped as versioned JSON | No scraping fragility, no copied method text, and the diet/cuisine/fridge-life tags are correct because we write them |
| Storage | Same `recipes` table + `is_catalog` flag | Grocery merge, macro estimates, cooking mode and plan slots keep working with zero duplication |
| Diets, first iteration | Balanced, High protein | Two is enough to prove the generator; the column is an array so more is additive |
| Scope | Leftovers + generator + tracker bridge | Week stays un-dated and shared. Dated weeks and history (roadmap #4) stay parked |

## Non-goals

- Dated weeks, week archive, "copy last week"
- Pantry / inventory — ruled out in `docs/ROADMAP.md`; depends on manual upkeep
- Any LLM call at runtime; the generator is a deterministic pure function
- Vegetarian / Mediterranean / keto tags this round

## Data model

### `recipes` — new columns, all guarded and defaulted

| Column | Type | Purpose |
|---|---|---|
| `is_catalog` | `boolean not null default false` | Seed-pool row vs a personal import |
| `catalog_slug` | `text unique` | Idempotency key for re-seeding |
| `cuisine` | `text` | `asian`, `american`, `italian`, `greek`, `mexican`, `spanish`, `indian`, `middle-eastern`, `other` |
| `diet_tags` | `text[] not null default '{}'` | `balanced`, `high-protein` |
| `meal_slots` | `text[] not null default '{}'` | Which of breakfast/lunch/dinner/snack it suits |
| `effort` | `text` | `minimal`, `easy`, `medium` — "Banana with Honey" is `minimal` |
| `keeps_days` | `integer not null default 0` | Fridge life; 0 means eat fresh |
| `batch_friendly` | `boolean not null default false` | Scales up and containers well |
| `reheat` | `text` | `microwave`, `oven`, `cold`, `fresh-only` |

`keeps_days` and `reheat` are what the leftover engine runs on. A wrong value produces a
bad plan, not a cosmetic blemish, so every dinner entry carries an honest one.

### `meal_plan` — new columns

| Column | Type | Purpose |
|---|---|---|
| `is_leftover` | `boolean not null default false` | This slot eats a batch cooked on another night |
| `cook_day` | `text` | Which day's batch, for the "Leftovers from Tue" label |
| `servings_planned` | `integer` | On cook nights: how many serves to make |

A leftover slot points at the same `recipe_id` as its cook night. That is what lets
groceries count the batch once and the tracker log identical macros.

### RLS and migration

No policy changes. Catalog rows are owned by Harrison, and `recipes: household read`
already lets both users read and plan them. Every column add is guarded and defaulted, so
the live shared database is unaffected until seeded. Per house rule the schema runs in the
Supabase dashboard *before* the dependent code is pushed. The dashboard's "destructive
operations" warning fires on the existing `drop policy if exists` lines and is safe — no
`DROP TABLE`, `DELETE` or `TRUNCATE` is added.

## The catalog

`src/shared/data/catalog-recipes.json`, one array of entries shaped like a `DraftRecipe`
plus the catalog metadata:

```json
{ "slug": "greek-chicken-tray-bake",
  "title": "Greek Chicken & Lemon Potato Tray Bake",
  "cuisine": "greek", "dietTags": ["balanced", "high-protein"],
  "mealSlots": ["dinner", "lunch"], "effort": "easy",
  "keepsDays": 3, "batchFriendly": true, "reheat": "oven",
  "servings": 4, "prepMin": 15, "cookMin": 45,
  "description": "...",
  "ingredients": ["600 g chicken thighs", "..."],
  "steps": ["...", "..."] }
```

Ingredient lines stay raw strings, parsed at seed time by the existing
`src/shared/ingredient-parser.ts` — the same path the URL scraper uses, so grocery merge
and macro estimation work unchanged.

Target mix, ~170 entries:

| Group | Count | Notes |
|---|---|---|
| Batch-friendly dinners | ~90 | Asian 18, Italian 15, American 14, Mexican 13, Greek 12, Spanish 10, other 8 |
| Lunch-forward / light mains | ~25 | Salads, bowls, wraps — many `keepsDays: 1` |
| Breakfasts | ~25 | Overnight oats, egg muffins, shakshuka |
| Minimal snacks and assemblies | ~30 | 1–3 ingredients, `effort: minimal` |

### Seeder

`scripts/seed-catalog.mjs`, following `scripts/migrate-to-supabase.mjs` conventions. Signs
in with email/password from `.env` (the Discord-bot pattern — publishable key plus RLS,
never a service-role key), then per entry: upsert `recipes` on `catalog_slug`, replace that
recipe's `ingredients` and `steps`, and compute the macro estimate with the existing
`macro-estimator.ts` and `au-foods.json` so the `est_*` columns match what `plannedFor()`
consumes. Idempotent, so it re-runs every time recipes are added.

It prints seeded / updated counts and per-recipe unmatched-ingredient counts. Anything
matching below ~60% gets its ingredient wording fixed rather than shipping a wrong estimate.

## The generator

`src/shared/plan-generator.ts` — pure, deterministic, no I/O, unit-tested first. It is the
feature's brain.

```ts
export interface GenerateOptions {
  diets: DietTag[]
  cuisines: Cuisine[]          // empty = all
  cookNights: number           // default 4
  servingsPerMeal: number      // default 2
  leftoverAppetite: 'low' | 'medium' | 'high'
  slots: PlanMeal[]
  locked: MealPlanEntry[]      // pinned slots, never overwritten
  seed: number                 // reproducible regenerate
}
export function generateWeek(catalog: RecipeSummary[], opts: GenerateOptions): MealPlanEntry[]
```

1. **Filter** by `dietTags ∩ opts.diets`, `cuisine ∈ opts.cuisines`, and slot fit.
2. **Dinners.** Spread `cookNights` days across the week, pick `batch_friendly` mains, and
   reject a pick matching the previous cook night's cuisine — variety without a mood board.
3. **Chain leftovers forward.** A cook night makes `servingsPerMeal × (1 + repeats)` serves
   and fills later slots. `leftoverAppetite` caps repeats per batch (low 1, medium 2,
   high 3). Hard rules: a leftover never sits further from its cook night than the recipe's
   `keeps_days`, and `reheat: 'fresh-only'` is never chained.
4. **Lunches.** Leftovers first — that is the point — then `minimal`/`easy` lunch fills.
5. **Breakfasts.** Rotate two or three `minimal` breakfasts. People genuinely repeat
   breakfast, so no variety penalty applies here.
6. Seeded xorshift RNG, no dependency, so Regenerate differs but reproduces.

Tests written first: no leftover outlives `keeps_days`; `fresh-only` never chained; locked
slots survive; more cook nights than available recipes degrades rather than throws; same
seed gives the same week.

## UI

### Meal plan page

- **Week summary bar** replacing the bare meta line: cook nights, distinct recipes, average
  kcal per day per person from `est`, labelled a best guess per house rule, alongside the
  existing "Send week to groceries".
- **Generate week** opens a `BottomSheet`: diet segmented control, cuisine chips,
  cook-nights stepper, servings stepper, leftover appetite, slot checkboxes, and a "keep
  slots I've already filled" toggle. The week previews in-sheet and applies on confirm —
  the shared plan is never silently overwritten.
- **Slot cards.** Cook nights show the thumbnail, a `cook · 4 serves` chip and cook time.
  Leftover slots render muted with a `Leftovers from Tue` chip and no thumbnail. This is
  what makes a repeated dinner read as intentional rather than as a duplicate.
- **Per-slot actions** in the edit sheet, on top of today's free-text and recipe picker:
  Log to tracker, Swap (three filtered suggestions), Make this a leftover of …, Clear.
- **Suggestions strip**: three catalog recipes fitting the emptiest slots, one tap to add.

### Library

A `Mine | Catalog` segmented control, plus cuisine, diet and effort chips in Catalog mode.
Catalog recipes open in the existing `RecipeDetailPage` unchanged — they are ordinary
`recipes` rows — and detail gains **Add to my library**, copying the row with
`owner_id = auth.uid()` and `is_catalog = false`. `listRecipes()` takes an
`{ catalog?: boolean }` filter so the plan picker searches the whole pool while the library
defaults to Mine.

### Tracker bridge, made two-way

The `RecipeSummary → FoodItem` conversion currently inlined in `MacroTrackerPage.tsx` moves
to `src/shared/plan-to-food.ts`. **Log to tracker** on any slot opens the existing
`AddFoodModal` through `App.tsx`'s already-plumbed `openAddFood(meal, planned)`, passing a
`source: 'plan'` item; leftover slots log identically. `plannedFor()` re-points at the
shared helper and labels leftovers.

### Groceries

`MealPlanPage` passes only `is_leftover = false` slots to `GroceryPreviewModal`, with
`scales` built from `servings_planned / recipe.servings`. A six-serve Tuesday batch then
buys six serves' worth once, instead of today's 1× regardless of repeats.
`grocery-merge.ts` already handles scaling.

## Risks

- **Catalog authoring is the schedule.** ~170 recipes is the bulk of the effort, hence
  batching. The generator is built against fixtures first so it is never blocked on content.
- **Estimates are only as good as `au-foods.json` matching.** The seeder reports unmatched
  counts; the UI keeps labelling estimates as best guesses.
- **Leftover safety rests on hand-authored `keeps_days`.** Conservative defaults: 3 for
  stews, curries, tray bakes and bolognese; 1 for dressed salads and seafood; `fresh-only`
  for anything fried or containing avocado.
- **The Discord bot reads `meal_text`.** Leftover slots must set it too (e.g.
  `Leftovers · Greek Chicken Tray Bake`) or the nightly post goes blank.
