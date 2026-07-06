# Metric Conversion (US → AU units) — Design

**Date:** 2026-07-06
**Status:** Approved (Harrison: imported American recipes should read in Australian units).

## Scope — what converts and what deliberately doesn't

- **Convert:** weights `oz`/`ounces` and `lb`/`pounds` → grams (nearest 5 g
  under 250 g, nearest 10 g above — "1 lb" reads 450 g, like AU cookbooks);
  temperatures `°F` → `°C` inside step text, rounded to the nearest 5
  ("360°F" → "180°C"). Quantity ranges convert both bounds ("1–2 lb" →
  "450–910 g"); mixed/vulgar fractions handled ("1 1/2 lb", "½ lb").
- **Keep:** cups/tbsp/tsp — Australians cook with them, and converting
  "1 cup flour" to grams needs ingredient density (a guess dressed as fact).
  ml/g stay as-is.

## Where it runs

1. **Import (automatic):** `RecipeReviewForm` converts the draft's ingredient
   lines + step texts before showing them, with a banner: "📏 Converted to
   metric: N measurements, M temperatures." Nothing changes silently; the
   review textarea shows the converted lines, and save re-parses them (so
   parsed quantity/unit become grams too). Applies to URL and Instagram
   imports alike; manual entry is a no-op.
2. **Existing recipes:** owner-only "📏 Convert to metric" button on the
   detail page (shown only when the recipe contains convertible units).
   Rewrites ingredient rows (raw + re-parsed fields) and step texts in place,
   then re-runs the macro estimate.

## Implementation

Pure `src/shared/unit-convert.ts` (TDD):
- `metricizeLine(raw)` → `{ text, changed }` (weights).
- `metricizeText(text)` → `{ text, changed: number }` (°F occurrences).
- `convertDraftToMetric(draft)` → `{ draft, measurements, temps }`.
- `hasImperialUnits(recipe)` helper for the detail-page button visibility.

Data: `convertRecipeToMetric(recipe)` in `data/recipes.ts` — per-ingredient
row updates keyed `(recipe_id, position)`, step text updates, then
`estimateAndSave`.

No schema change. Plain push.
