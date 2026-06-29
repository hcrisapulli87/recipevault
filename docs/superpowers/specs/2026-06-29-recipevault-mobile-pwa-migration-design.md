# RecipeVault — Mobile / PWA migration (Supabase, dual-target)

**Date:** 2026-06-29
**Status:** Approved design

## Context

RecipeVault is a local single-user Electron app (React + sql.js, IPC) that imports/stores
recipes, plans the week (syncs to a Discord bot via `meal_plan.json`), pushes groceries to
Google Tasks, and — as of this week — tracks daily macros (Breakfast/Lunch/Dinner/Snack with
protein/carbs/fat/calories, per profile, food search + barcode).

The macro tracker is the feature that wants a phone (log on the go, scan barcodes in the
kitchen), and the broader app is useful on mobile too (view a recipe while cooking, check the
grocery list at the store). Harrison chose to **migrate the whole app to mobile now** as a
hosted, installable PWA, with **two separate logins** (each person sees only their own data),
and to **defer photo→macro AI**.

A previous session left scaffolding on `main`: `supabase/schema.sql`
(recipes/ingredients/steps/meal_plan/grocery_items, owner-scoped RLS, Realtime), a web/PWA
build (`vite.config.ts` + vite-plugin-pwa → `dist-web`, Vercel), `.env.example`, and a
`public/favicon.svg`. It is **only scaffolding** — no Supabase client, auth, serverless
functions, data layer, tracker tables, or migration script exist, and the renderer still calls
`window.api` (IPC) everywhere.

## Goals

- One codebase (`src/renderer`) running as **both** the Electron desktop app and a web PWA,
  **both backed by the same Supabase Postgres** (single source of truth, live cross-device sync).
- Multi-user: two people each sign in (magic link) and see only their own recipes, plan,
  groceries, and macros (RLS `owner_id = auth.uid()`).
- Installable, responsive PWA that works well on a phone (camera barcode scanning included).
- Preserve existing behaviour where it still makes sense; migrate existing recipe data once.

## Non-goals (out of scope)

- **Photo → macro AI** (deferred; the data model already accepts a confirmed `FoodItem`).
- **Offline data sync** — the PWA caches the app shell (installable/launchable offline), but
  data operations require connectivity. No local write queue / conflict resolution.
- **Discord bot rewrite** — the bot will later read the plan from Supabase REST (the schema's
  `meal_text` column exists for it); that change is a separate follow-up, not this build.
- **Google Tasks groceries** — replaced by a built-in Supabase grocery list.

## Architecture

```
            ┌──────────────────────────┐
            │      src/renderer (React)│  ← one codebase
            └───────────┬──────────────┘
        electron.vite ──┤              ├── vite (web)
                        ▼              ▼
                 Electron shell    PWA on Vercel
                        └──────┬───────┘
                               ▼  @supabase/supabase-js (HTTPS) + magic-link auth
                        ┌──────────────┐      ┌─────────────────────┐
                        │  Supabase     │      │ Vercel /api/scrape   │
                        │  Postgres+RLS │      │ (recipe URL → JSON)  │
                        │  + Realtime   │      └─────────────────────┘
                        └──────────────┘
```

**Decision (data layer):** the renderer talks to Supabase **directly on both targets** via a new
`src/renderer/data/*` module set, replacing all `window.api` data calls. Rejected alternatives:
an IPC-on-desktop/Supabase-on-web *adapter* (two backends → data not shared, defeats the goal),
and an *offline-first sql.js cache + sync* (conflict-resolution complexity, YAGNI).

**Recipe scraping** moves to a Vercel serverless function `/api/scrape` (browsers can't fetch
third-party recipe pages — CORS). Both targets call it over HTTPS (`VITE_SCRAPE_URL`, defaulting
to same-origin `/api/scrape` on the PWA). The existing `recipe-scraper.ts` logic relocates there.

**OpenFoodFacts** (search + barcode) is called **client-side** (OFF sends
`Access-Control-Allow-Origin: *`); if a CORS issue arises, fall back to an `/api/off` proxy.

## Auth & multi-user

- Supabase email **magic-link** sign-in (mirrors Tandem). An `<AuthGate>` wraps the app: signed
  out → a single sign-in screen; signed in → the app.
- Two users (Harrison + one other). Email auth enabled; the two users added in the dashboard
  (open sign-ups stay off — invite-only). RLS `owner_id = auth.uid()` isolates each user's data.
- The publishable key (`sb_publishable_…`) ships in the client (safe; security is RLS). Real
  `.env` stays gitignored; `.env.example` documents the vars.

## Data model (Supabase)

Reuse `supabase/schema.sql` as-is for recipes/ingredients/steps/meal_plan/grocery_items (already
owner-scoped + Realtime). **Add** the tracker tables (and the multi-user note: remove the
"single-user / disable sign-ups" guidance from the file header):

- `profiles` — `id uuid primary key references auth.users(id) on delete cascade`,
  `display_name text`, `cal_goal/protein_goal/carbs_goal/fat_goal real`. One row per user — the
  app upserts it on first sign-in (no DB trigger needed). RLS: own row only.
- `food_log` — `id`, `owner_id` (default `auth.uid()`), `log_date date`, `meal_type` (check
  breakfast/lunch/dinner/snack), `name`, `brand`, `amount real default 1`, `unit text`,
  `base_calories/base_protein/base_carbs/base_fat real`, `barcode`, `source`, `created_at`.
  Index `(owner_id, log_date)`. RLS: own rows. Realtime on.
- `food_cache` — `barcode primary key`, name/brand/serving/unit + per-unit macros + `last_fetched`.
  **Shared**: RLS allows read + upsert to all authenticated users (OFF data isn't private), so one
  person's scan benefits both.

"Two profiles" from the desktop build collapses into "two auth users" — each person *is* a
profile; no profile-switcher; goals are one row per user.

## Data access layer (`src/renderer/data/`)

Typed modules wrapping the Supabase client, replacing `window.api.*`. Components import these:

- `supabase.ts` — the browser client from `VITE_SUPABASE_URL` + publishable key; `auth.ts` helpers.
- `recipes.ts` — `listRecipes`, `getRecipe`, `saveRecipe` (insert recipe + children), `deleteRecipe`.
- `mealPlan.ts` — `getMealPlan`, `setMeal`, `clearWeek` (writes `meal_text` for the bot).
- `groceries.ts` — `listGroceries`, `addGroceries`, `toggleGrocery`, `clearChecked`.
- `tracker.ts` — `getProfile`/`upsertProfileGoals`, `getDailyLog`, `addLogEntry`, `updateLogEntry`,
  `deleteLogEntry`. Daily totals computed client-side from per-unit × amount (reuse `computeTotals`).
- `foods.ts` — bundled-staples search (move `common-foods.json` into the renderer) + OFF search +
  barcode lookup with the `food_cache` table.
- `scrape.ts` — `POST` to `VITE_SCRAPE_URL` (`/api/scrape`).

Shared pure logic (ingredient parser, grocery merge, OFF mapper, totals) moves to `src/shared`
so it's reused by the renderer and the serverless function and stays unit-testable.

## Feature mapping

- **Recipes** — same library/detail/cooking UI; data via `recipes.ts`. Import: paste URL →
  `/api/scrape` → review form → `saveRecipe`.
- **Meal plan** — `mealPlan.ts`; sets `meal_text` so the bot can read it later via REST.
- **Groceries** — new checklist page on `grocery_items` (add items, tick off, clear checked),
  plus "send recipe ingredients to the list" (reuse `grocery-merge`). Replaces Google Tasks.
- **Macro tracker** — the existing UI (`MacroTrackerPage`, `AddFoodModal`, `BarcodeScanner`,
  goals editor), rewired to `tracker.ts`/`foods.ts`. Goals live on the user's `profiles` row.

## PWA & mobile UX

- vite-plugin-pwa (configured) — installable, app-shell precache; add real `pwa-192.png` /
  `pwa-512.png` (generate from the existing icon).
- Responsive: the desktop sidebar becomes a bottom nav (or hamburger) under a mobile breakpoint;
  pages reflow to single-column; tap targets sized for touch.
- Camera permission flow for barcode on mobile (getUserMedia + `@zxing`).

## Electron desktop

Main process slims to a window shell loading the same renderer (which now uses Supabase). Remove
the data IPC handlers, sql.js, `google-tasks.ts`, and `bot-mealplan-sync.ts` (replaced). The
desktop app keeps working — now against Supabase, so it needs network + login. The
`npm run app` launcher (build + preview) is unaffected.

## Data migration

`scripts/migrate-to-supabase.mjs` — one-time import of existing local `recipe-vault.sqlite`
recipes (and optionally macro logs) into Supabase, stamped with Harrison's user id (service login
via `MIGRATE_EMAIL`/`MIGRATE_PASSWORD` from `.env`, not shipped). Run once after the schema is up.

## Deployment

- **Supabase**: Harrison creates the project, runs `supabase/schema.sql`, enables email auth, adds
  the two users. (Account-bound — his to do; I provide the SQL + steps.)
- **Vercel**: connect the repo, set `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`, build
  `npm run build:web` → `dist-web`, deploy `/api/*`. (His to do; I provide config + `.env.example`.)

## Build sequence (phases within this spec)

1. **Foundation** — Supabase client + magic-link `<AuthGate>` + `data/` scaffold + dual-build
   wiring; app boots on web behind login against Supabase (features stubbed/empty).
2. **Schema** — add tracker tables + multi-user tweaks to `supabase/schema.sql`.
3. **Feature migration** — recipes (+ `/api/scrape`) → meal plan → groceries → macro tracker,
   one at a time, each fully working before the next.
4. **PWA + responsive/mobile polish** — bottom nav, reflow, icons, camera flow.
5. **Electron slim-down** — remove replaced main-process code; verify desktop still works.
6. **Data migration script** + deploy docs.
7. *(Follow-up, separate spec)* Discord bot → Supabase REST.

## Testing

- Unit: shared pure logic (ingredient parser, grocery merge, OFF `mapOffProduct`, `computeTotals`)
  — reuse/relocate existing tests; data-layer modules tested against a mocked Supabase client;
  `/api/scrape` reuses the existing scraper tests.
- Manual: sign in on phone + desktop, confirm same data both places (Realtime), log macros + scan
  a barcode on the phone, import a recipe, build/check a grocery list, install the PWA to home
  screen. Confirm a second user sees only their own data.

## Risks / watch-items

- **Desktop loses offline-local use** (now needs network + login) — accepted trade-off of one
  shared backend.
- **OFF CORS** from the browser — fall back to an `/api/off` proxy if blocked.
- **Big refactor surface** — every page moves off `window.api`; mitigated by doing it
  feature-by-feature with the app green after each.
- **Discord bot** keeps reading the stale `meal_plan.json` until its follow-up lands; `meal_text`
  is written now so that change is small.
