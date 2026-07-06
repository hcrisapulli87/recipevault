# Three-Meal Planner — Design

**Date:** 2026-07-06
**Status:** Approved (Harrison, 2026-07-06). Plan skipped by request — small change, implemented directly.

## Goal

The weekly meal planner currently holds one meal per day. Extend it to three
slots per day — breakfast, lunch, dinner — so a full week is 21 slots.

## Decisions

- **Slots:** exactly breakfast / lunch / dinner. No snack slot (can be added
  later if missed; unfilled optional slots become dead weight).
- **Migration:** start fresh. Existing one-per-day rows are deleted rather than
  relabelled — Harrison chose the clean board over migrating current entries.

## Schema (Supabase)

`meal_plan` gains a `meal text` column checked against
`('breakfast','lunch','dinner')`, and the primary key changes from
`(owner_id, day)` to `(owner_id, day, meal)`. Everything else is unchanged:
recipe FK with `on delete set null`, `free_text`, denormalised `meal_text`,
table-level RLS policies, realtime publication.

The migration lives in `schema.sql` as an idempotent guarded block: add the
column if missing, delete legacy rows (`meal is null`), swap the primary key.
Re-runs are no-ops. This is the one place the schema script deletes rows — a
one-time cutover, called out in the script header.

**Deploy order:** Harrison runs the updated schema.sql in the Supabase
dashboard BEFORE the push, so Vercel deploys against the upgraded table. The
SQL editor will flag the `delete` as destructive — that one is real (it clears
the current week) and expected. Between migration and redeploy, an open old
client can't save meals (its upsert targets the old key); viewing still works.

## Types & data layer

- `PlanMeal` = `Exclude<MealType, 'snack'>`; `PLAN_MEALS` ordered
  breakfast → lunch → dinner. Labels reuse the tracker's `MEAL_LABEL`.
- `MealPlanEntry` gains `meal: PlanMeal`.
- `getMealPlan` returns 21 entries (7 days × 3 meals, blanks filled in).
- `setMeal` takes `meal`, upserts on `owner_id,day,meal`.
- `clearWeek` unchanged (already deletes all the owner's rows).

## UI

Desktop keeps the 7-day-column board; each day column stacks three slots with
small Breakfast / Lunch / Dinner captions. Each slot behaves exactly like
today's cell: recipe card with image, free-text card, or dashed `+`, with the
same search/free-text editor popover. Mobile (single-column board) shows each
day as a section with its three slots as compact rows.

"Send week to groceries" gathers recipe ids across all 21 slots (already
deduped). "Clear week" clears everything.

## Not touched

The Discord bot keeps its own `meal_plan.json` (one meal/day) — it is not
wired to RecipeVault yet, so nothing breaks. The bot's format is that
project's decision when sync is eventually built.

## Testing

New `tests/data-meal-plan.test.ts` covering the data layer with the same
in-memory Supabase mock pattern as `data-tracker.test.ts`: 21-slot fill-in,
slot-keyed upsert payload, meal_text denormalisation.
