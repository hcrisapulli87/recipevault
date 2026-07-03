# Household sharing — design

2026-07-03. Approved by Harrison (recommendations accepted as-is).

## What

The two household users can see each other's data, read-only:

- **Shared recipe library** — all recipes visible to both, automatically. Recipes
  imported by the other person show an "added by [name]" chip. Anyone can open,
  cook, and meal-plan any recipe; only the owner can delete it.
- **Me/partner switcher** on the Meal Plan and Tracker pages. The partner view is
  the same layout with every editing control hidden and a "viewing [name] — read
  only" note. Realtime keeps it live.
- **Groceries and the barcode cache stay private** (unchanged).

## Security model

All enforcement is Postgres RLS; the UI hiding buttons is convenience, not
security. Each shared table's single "own rows for all" policy splits into:

- `select` → any `authenticated` user (`using (true)`)
- `insert` / `update` / `delete` → owner only (`owner_id = auth.uid()`)

Applied to: `recipes`, `ingredients`, `steps`, `meal_plan`, `food_log`,
`profiles` (id = auth.uid() for writes). NOT applied to `grocery_items` or
`food_cache`. Sign-ups are disabled, so "any authenticated user" = the two
household accounts. `profiles` joins the realtime publication so goal/name
changes sync live.

## Code changes

- **Schema** (`supabase/schema.sql`, idempotent as always): policy split +
  profiles realtime. Harrison re-runs it in the SQL Editor **before** the push.
- **Data layer**: queries stop relying on RLS for scoping —
  `getMealPlan(ownerId)` and `getDailyLog(date, owner)` filter explicitly;
  partner's daily log shows *their* goals (read from their profiles row);
  `listRecipes`/`getRecipe` return `ownerId`; new `listProfiles()` returns
  `{ id, name, isMe }[]` for the switcher and chips.
- **UI**: `PersonSwitcher` component (hidden until both profiles exist);
  read-only modes on `MealPlanPage` + `MacroTrackerPage`; owner chip in
  `LibraryPage`; Delete hidden on `RecipeDetailPage` for non-owned recipes.

## Out of scope

Editing each other's data, shared grocery list, "send their week to my
groceries", >2 users, notifications. All addable later without rework.

## Verification

Typecheck + vitest + both builds. Manual (two accounts): partner's recipe
visible with chip and no Delete; switcher shows partner plan/tracker read-only
and updates live; REST write against partner's rows is refused by RLS;
groceries remain private.
