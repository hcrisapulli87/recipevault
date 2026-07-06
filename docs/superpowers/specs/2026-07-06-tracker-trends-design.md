# Tracker Trends View — Design

**Date:** 2026-07-06
**Status:** Approved (roadmap #2; part of Harrison's "implement these going down the list").

## Goal

A rear-view mirror for the macro tracker: 7/30-day averages against goals,
a logging streak, and a last-14-days calorie bar strip. Pure read view over
the existing `food_log` — zero new data entry, no schema change.

## Design

**UI.** A "📈 Trends" toggle in the tracker header swaps the day view
(date nav + hero + meals) for the trends view on the same page. The
Me/partner switcher keeps working (trends are read-only by nature, so the
partner view needs no special casing). Toggle back with "Today".

Trends view contents:
1. **Summary cards** for 7-day and 30-day windows: average kcal (vs calorie
   goal when set), average protein (vs goal), and "logged N of 7/30 days".
   Averages are over **logged days only** — an unlogged day is unknown, not a
   zero-calorie day; the logged-day count keeps that honest.
2. **Logging streak** — consecutive logged days ending today *or yesterday*
   (today being empty so far shouldn't break the streak at breakfast time).
3. **Last-14-days bar strip** — one CSS bar per day (height ∝ calories,
   capped at 150% of goal), coloured within-goal vs over-goal (goal-less:
   neutral accent), weekday initial underneath, today highlighted.

**Data.** New `getDailyTotalsRange(ownerId, from, to)` in `data/tracker.ts`:
one select of `log_date, amount, base_calories, base_protein, base_carbs,
base_fat` filtered by owner + date range (RLS household-read already allows
partner rows), aggregated client-side into `Map<date, DailyTotals>`.

**Pure logic** (`src/shared/trends.ts`, fully tested):
- `summarizeWindow(totalsByDate, today, days)` → `{ avg: DailyTotals | null,
  loggedDays, windowDays }` (avg null when nothing logged).
- `loggingStreak(totalsByDate, today)` → number.
- `dayBars(totalsByDate, today, n)` → `{ date, calories, logged }[]`
  oldest→newest (bar scaling/colour is the view's job).

Goals come from the already-loaded profile/goals (same source the day view
uses).

## Not doing

Best/worst-day callouts, macro-split charts, weight tracking, exports — wait
for real use. No chart library (CSS/SVG bars only, matching the Studio look).

## Deploy

No schema step; plain push → Vercel.

## Testing

Unit tests for the three pure functions (logged-only averaging, streak
edge cases incl. the yesterday grace, bar window fill) and the range
aggregation (supabase mock).
