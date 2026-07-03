# Household sharing — implementation plan

Spec: `docs/superpowers/specs/2026-07-03-household-sharing-design.md`.
One commit per task. Verify with `npm run typecheck && npm run test:run && npm run build:web` at the end.

## Task 1 — Schema: read-all/write-own policies
`supabase/schema.sql`: for recipes, ingredients, steps, meal_plan, food_log,
profiles — drop the single "own rows" policy, create `select using (true)` for
authenticated plus owner-only insert/update/delete policies. Add `profiles` to
the realtime publication array. Update the header comment (no longer "sees only
their own data"). grocery_items and food_cache untouched.

## Task 2 — Data layer: owner-aware queries
- `src/renderer/data/users.ts` (new): `listProfiles()` → `{ id, name, isMe }[]`,
  ordered me-first.
- `types.ts`: `RecipeSummary.ownerId`, `Recipe.ownerId`.
- `recipes.ts`: select `owner_id` in listRecipes/getRecipe.
- `mealPlan.ts`: `getMealPlan(ownerId)` filters `.eq('owner_id', ownerId)`.
- `tracker.ts`: `getDailyLog(date, owner: { id; isMe })` — filters food_log by
  owner id; goals come from that owner's profiles row (own profile still
  auto-created via getProfile; partner's read plainly, null goals if absent).

## Task 3 — UI: switcher + read-only views + owner chips
- `components/PersonSwitcher.tsx` (new): pill toggle from `listProfiles()`,
  renders nothing when only one profile exists.
- `MealPlanPage`: `viewer` state; partner view hides edit/clear/grocery
  controls, shows read-only note.
- `MacroTrackerPage`: same treatment (no add/edit/delete/goals in partner view).
- `LibraryPage`: "added by [name]" chip on non-owned recipes.
- `RecipeDetailPage`: Delete only for the owner.

## Task 4 — Docs + verification
README: sharing section + verification checklist items. Run full verification.
Hand-off: Harrison re-runs schema.sql, then push (schema before push).
