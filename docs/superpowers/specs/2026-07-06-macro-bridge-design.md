# Plan → Tracker Macro Bridge — Design

**Date:** 2026-07-06
**Status:** Approved (roadmap #1; Harrison: "start the implementation on these going down this list").

## Goal

(a) Every recipe shows estimated macros per serving, computed from its parsed
ingredients. (b) When adding food to the tracker, the recipe planned for that
meal (today's weekday) is offered as a one-tap log entry using those macros.

## Estimation model (shared, pure, tested)

`src/shared/macro-estimator.ts`:

- Per-ingredient grams:
  - `quantity` present + canonical unit → grams via a conversion table
    (g/kg/ml/l direct with ml≈g; tsp 5, tbsp 15, cup 240, oz 28.35, lb 453.6,
    clove 3, can/tin 400, slice 25, pinch 0.3, handful 30, pack 250, jar 300,
    bottle 500, bunch 100, sprig 2, stick 50, knob 15).
  - `quantity` present, no unit (counts: "2 eggs", "1 onion") → typical-weight
    keyword table (~20 common items: egg 50, onion 150, potato 200 …);
    fallback to the matched staple's serving grams; else unmatched.
  - Ranges use the midpoint ((quantity+quantityMax)/2).
  - No quantity at all ("Salt & pepper") → skipped as unmatched (negligible).
- Macros: grams × matched per-100g values. Matching is done by the CALLER —
  the estimator takes a per-ingredient `(Per100g | null)[]` so it stays pure.
- Output: per-serving calories/protein/carbs/fat (servings ?? 4 — flagged),
  matched/total ingredient counts, and a per-ingredient detail array for the
  transparency breakdown.

Matching (`src/renderer/data/macroEstimate.ts`): staples first (substring,
shortest match wins — cleanest per-100g data, offline-safe), then the
AU-first `/api/food-search` proxy (first hit with `energy-kcal_100g`),
sequentially with small concurrency. Per-100g comes straight from raw
nutriments (no `mapOffProduct` — that returns per-serving items).

## Storage & types

`recipes` gains nullable columns (idempotent `add column if not exists`):
`est_cal_serve, est_protein_serve, est_carbs_serve, est_fat_serve` (real),
`est_matched, est_total` (int), `est_computed_at` (timestamptz). Summary
scalars only — the per-ingredient breakdown is shown at compute time, not
persisted. `Recipe` and `RecipeSummary` gain `est: RecipeEstimate | null`.
`FoodItem.source` union gains `'plan'`.

## UI

- **Recipe detail:** an estimate block — "~620 kcal · P42/C58/F18 per serve ·
  best guess, matched 10 of 12 ingredients" — with ♻️ Recalculate, and an
  expandable per-ingredient breakdown after an in-session compute. When no
  estimate exists yet: an "Estimate macros" button (covers pre-existing
  recipes).
- **Library cards:** "~620 kcal/serve" line when present.
- **Auto-compute on save:** RecipeReviewForm fires the estimate in the
  background after `saveRecipe` (non-blocking; failures silent — the detail
  page button always recovers).
- **Tracker (phase b):** AddFoodModal accepts an optional `planned` FoodItem.
  MacroTrackerPage maps the viewed date → weekday → the current user's plan
  slot for the meal being added (breakfast/lunch/dinner; snacks have no slot)
  and, when that slot holds a recipe with an estimate, the modal's search tab
  leads with a one-tap "📋 Planned: <title> · ~620 kcal/serve" card →
  PortionStep (default 1 serving) → logged with `source: 'plan'`.

## Constraints & honesty

Estimates are heuristic (unit densities vary, count weights are typical) —
always labelled "best guess"; the matched-X-of-Y count sets expectations, the
breakdown shows exactly what matched what. Estimates NEVER overwrite logged
history (log entries copy the values at log time, same as every other source).

## Not doing

No per-ingredient manual match overrides (YAGNI until real-world misses
demand it); no estimate for free-text plan slots; no recompute-on-every-view
(stored scalars; manual/auto recompute only).

## Deploy order

Additive schema re-run BEFORE push (the usual dashboard step), then push.

## Testing

- Unit: estimator (unit table, counts, ranges, servings default, unmatched
  skip, per-serving math); staple per-100g lookup; `computeRecipeEstimate`
  with stubbed fetch (staple hit, proxy hit, proxy miss).
- Existing suite stays green (recipes mapping change touches `data-tracker`
  patterns only additively).
