# RecipeVault Mobile/PWA Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate RecipeVault to a dual-target app — the same `src/renderer` runs as the Electron desktop app and an installable web PWA, both backed by one Supabase Postgres with per-user (magic-link) auth and RLS, so recipes, meal plan, groceries, and the macro tracker sync across desktop and phone.

**Architecture:** The renderer drops Electron IPC for data and talks to Supabase directly through a `src/renderer/data/*` layer (used identically on both targets). Recipe scraping moves to a Vercel serverless `/api/scrape`. Groceries move from Google Tasks to a Supabase table. Pure logic (parser, grocery-merge, OFF mapper, totals) lives in `src/shared` and is reused by renderer + serverless + tests.

**Tech Stack:** React 19 + TypeScript, Vite + vite-plugin-pwa (web), electron-vite (desktop), `@supabase/supabase-js`, Supabase (Postgres + Auth + Realtime + RLS), Vercel (static + `/api`), `@zxing/library` (barcode), Vitest.

**Branch:** create `feat/mobile-pwa` off `main` before Task 1 (via superpowers:using-git-worktrees or `git switch -c feat/mobile-pwa`). Each task ends in a commit on that branch.

**Reference:** spec at `docs/superpowers/specs/2026-06-29-recipevault-mobile-pwa-migration-design.md`.

---

## Phase 1 — Foundation, schema, auth, data-layer scaffold

### Task 1: Verify deps + add web env types

**Files:**
- Modify: `package.json` (confirm `@supabase/supabase-js`, `vite-plugin-pwa` present — both already are)
- Create: `src/renderer/vite-env.d.ts`

- [ ] **Step 1:** Create `src/renderer/vite-env.d.ts` declaring the env vars:

```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  readonly VITE_SCRAPE_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 2:** Run `npm ls @supabase/supabase-js vite-plugin-pwa` → both resolve.
- [ ] **Step 3:** Commit: `git add -A && git commit -m "chore: web env typings for Supabase migration"`

### Task 2: Extend Supabase schema with tracker tables + multi-user

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1:** Edit the file header: remove the "single-user / disable sign-ups" guidance; replace with a multi-user note (two users invited in the dashboard; RLS isolates each).

- [ ] **Step 2:** Append the tracker tables + RLS + realtime before the final realtime block (keep idempotent drop-and-recreate policy style used in the file):

```sql
-- ── Macro tracker ────────────────────────────────────────────────────────────
-- One profile row per auth user (display name + daily goals). App upserts on first sign-in.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  cal_goal     real,
  protein_goal real,
  carbs_goal   real,
  fat_goal     real
);

create table if not exists public.food_log (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  log_date      date not null,
  meal_type     text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  name          text not null,
  brand         text,
  amount        real not null default 1,
  unit          text not null default 'serving',
  base_calories real not null default 0,
  base_protein  real not null default 0,
  base_carbs    real not null default 0,
  base_fat      real not null default 0,
  barcode       text,
  source        text not null default 'manual',
  created_at    timestamptz not null default now()
);
create index if not exists food_log_owner_day_idx on public.food_log (owner_id, log_date);

-- Shared barcode cache (OpenFoodFacts data is not private): any authed user reads/writes.
create table if not exists public.food_cache (
  barcode          text primary key,
  name             text not null,
  brand            text,
  serving_desc     text,
  unit             text not null,
  cal_per_unit     real not null default 0,
  protein_per_unit real not null default 0,
  carbs_per_unit   real not null default 0,
  fat_per_unit     real not null default 0,
  last_fetched     timestamptz not null default now()
);

alter table public.profiles   enable row level security;
alter table public.food_log   enable row level security;
alter table public.food_cache enable row level security;

drop policy if exists "profiles: own row" on public.profiles;
create policy "profiles: own row" on public.profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "food_log: own rows" on public.food_log;
create policy "food_log: own rows" on public.food_log
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "food_cache: shared read" on public.food_cache;
create policy "food_cache: shared read" on public.food_cache
  for select to authenticated using (true);
drop policy if exists "food_cache: shared upsert" on public.food_cache;
create policy "food_cache: shared write" on public.food_cache
  for insert to authenticated with check (true);
drop policy if exists "food_cache: shared update" on public.food_cache;
create policy "food_cache: shared update" on public.food_cache
  for update to authenticated using (true) with check (true);
```

- [ ] **Step 3:** Add `food_log` to the realtime `foreach` array in the existing realtime block.
- [ ] **Step 4:** Commit: `git add supabase/schema.sql && git commit -m "feat(supabase): tracker tables (profiles/food_log/food_cache) + RLS"`

### Task 3: Supabase client + auth helpers

**Files:**
- Create: `src/renderer/data/supabase.ts`
- Create: `src/renderer/data/auth.ts`

- [ ] **Step 1:** `supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) console.warn('Supabase env vars missing — set VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY')

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true }
})
```

- [ ] **Step 2:** `auth.ts`:

```ts
import { supabase } from './supabase'
import type { Session } from '@supabase/supabase-js'

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}
export function onAuthChange(cb: (s: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session))
  return () => data.subscription.unsubscribe()
}
export async function sendMagicLink(email: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  })
  return { error: error?.message ?? null }
}
export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
```

- [ ] **Step 3:** Run `npm run typecheck:web` → passes.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat: supabase client + auth helpers"`

### Task 4: Auth gate + sign-in screen

**Files:**
- Create: `src/renderer/components/AuthGate.tsx`
- Create: `src/renderer/pages/SignInPage.tsx`
- Modify: `src/renderer/main.tsx` (wrap `<App/>` in `<AuthGate>`)

- [ ] **Step 1:** `SignInPage.tsx` — email input + "Send magic link", success/error banners (reuse `.field`/`.btn`/`.banner` classes):

```tsx
import { useState } from 'react'
import type { JSX } from 'react'
import { sendMagicLink } from '../data/auth'

export function SignInPage(): JSX.Element {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (): Promise<void> => {
    setBusy(true); setError(null)
    const { error } = await sendMagicLink(email.trim())
    setBusy(false)
    if (error) setError(error)
    else setSent(true)
  }
  return (
    <div className="signin">
      <h1 className="signin__title">🍳 RecipeVault</h1>
      {sent ? (
        <div className="banner banner--ok">Check your email for a sign-in link.</div>
      ) : (
        <>
          <label className="field">
            <span className="field__label">Email</span>
            <input className="text-input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>
          {error && <div className="banner banner--error">{error}</div>}
          <button className="btn btn--primary" onClick={submit} disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Send magic link'}
          </button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2:** `AuthGate.tsx` — subscribe to session; show loading, then `SignInPage` or children:

```tsx
import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, onAuthChange } from '../data/auth'
import { SignInPage } from '../pages/SignInPage'

export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    getSession().then((s) => { setSession(s); setLoading(false) })
    return onAuthChange(setSession)
  }, [])
  if (loading) return <p className="empty-note">Loading…</p>
  if (!session) return <SignInPage />
  return <>{children}</>
}
```

- [ ] **Step 3:** Wrap in `main.tsx`: import `AuthGate`, render `<AuthGate><App /></AuthGate>`.
- [ ] **Step 4:** Add `.signin` styles to `styles.css` (centered column, max-width 360px).
- [ ] **Step 5:** Run `npm run typecheck:web` → passes.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "feat: magic-link auth gate + sign-in screen"`

### Task 5: Move shared pure logic to src/shared

**Files:**
- Move: `src/main/recipe-scraper.ts` → `src/shared/recipe-scraper.ts` (it's pure fetch+parse; keep `fetch` usage — runs in serverless/Node)
- Move: `src/main/grocery-merge.ts` → `src/shared/grocery-merge.ts`
- Move: `src/main/nutrition.ts` (mapOffProduct, searchStaples, OFF calls) → `src/shared/nutrition.ts`
- Move: `src/main/data/common-foods.json` → `src/shared/data/common-foods.json`
- Move: `computeTotals` + tracker row mappers from `src/main/db.ts` into `src/shared/tracker-logic.ts`
- Modify: existing test imports in `tests/*` to new paths

- [ ] **Step 1:** Move files; update import paths inside them and in `tests/recipe-scraper.test.ts`, `tests/grocery-merge.test.ts`, `tests/nutrition.test.ts`, `tests/food-log.test.ts` (computeTotals import).
- [ ] **Step 2:** Run `npm run test:run` → all existing tests pass from new locations.
- [ ] **Step 3:** Commit: `git add -A && git commit -m "refactor: move pure logic (scraper, grocery-merge, nutrition, totals) to src/shared"`

### Task 6: Data-layer module signatures + shared types

**Files:**
- Modify: `src/shared/types.ts` (types already exist; add `GroceryItem`)
- Create: `src/renderer/data/recipes.ts`, `mealPlan.ts`, `groceries.ts`, `tracker.ts`, `foods.ts`, `scrape.ts`

- [ ] **Step 1:** Add `GroceryItem` to types:

```ts
export interface GroceryItem {
  id: string
  name: string
  qtyText: string | null
  checked: boolean
  sortOrder: number
}
```

- [ ] **Step 2:** Create each data module with Supabase-backed implementations matching these signatures (full bodies in Phase 2 tasks; here they are implemented, not stubbed):
  - `recipes.ts`: `listRecipes(): Promise<RecipeSummary[]>`, `getRecipe(id): Promise<Recipe|null>`, `saveRecipe(draft): Promise<number>`, `deleteRecipe(id): Promise<void>`
  - `mealPlan.ts`: `getMealPlan(): Promise<MealPlanEntry[]>`, `setMeal(day,recipeId,freeText): Promise<void>`, `clearWeek(): Promise<void>`
  - `groceries.ts`: `listGroceries(): Promise<GroceryItem[]>`, `addGroceries(names): Promise<void>`, `toggleGrocery(id,checked): Promise<void>`, `clearChecked(): Promise<void>`
  - `tracker.ts`: `getProfile(): Promise<Profile>` (upsert if missing), `updateGoals(goals): Promise<void>`, `getDailyLog(date): Promise<DailyLog>`, `addLogEntry(entry): Promise<void>`, `updateLogEntry(id,amount): Promise<void>`, `deleteLogEntry(id): Promise<void>`
  - `foods.ts`: `searchFoods(q): Promise<FoodItem[]>`, `lookupBarcode(code): Promise<FoodItem|null>`
  - `scrape.ts`: `scrapeUrl(url): Promise<IpcResult<DraftRecipe>>`

(Each is implemented in its feature task below; this task creates the files with the recipes implementation as the template and the rest filled in across Phase 2.)

- [ ] **Step 3:** `npm run typecheck:web`.
- [ ] **Step 4:** Commit: `git add -A && git commit -m "feat: data-layer module scaffolding + GroceryItem type"`

---

## Phase 2 — Feature migration (each leaves the app green)

### Task 7: Recipes via Supabase

**Files:**
- Modify: `src/renderer/data/recipes.ts`
- Test: `tests/data-recipes.test.ts` (mock supabase)
- Modify: `src/renderer/hooks/useRecipes.ts`, `pages/LibraryPage.tsx`, `pages/RecipeDetailPage.tsx`, `components/RecipeReviewForm.tsx` — replace `window.api.{getRecipes,getRecipe,saveRecipe,deleteRecipe}` with the `recipes.ts` functions.

- [ ] **Step 1:** Implement `recipes.ts` with Supabase queries: `listRecipes` → `select id,title,image_url,total_min order by title`; `getRecipe` → recipe + `ingredients`/`steps` ordered by position; `saveRecipe` → insert recipe `select id`, then bulk-insert ingredients/steps with `recipe_id`; `deleteRecipe` → delete (cascades handle children). Map snake_case ↔ camelCase.

- [ ] **Step 2:** Write `tests/data-recipes.test.ts` mocking `./supabase` (vi.mock) to assert `saveRecipe` inserts recipe then children with returned id, and `getRecipe` shape. Run → fails, then passes after Step 1.

- [ ] **Step 3:** Refactor the four renderer files to import from `../data/recipes` (or `../../data/recipes`) instead of `window.api`. (Signatures match, so call sites change only the source.)

- [ ] **Step 4:** `npm run typecheck:web && npm run test:run`.
- [ ] **Step 5:** Commit: `git commit -am "feat: recipes via Supabase data layer"`

### Task 8: Recipe scraping via Vercel serverless `/api/scrape`

**Files:**
- Create: `api/scrape.ts` (Vercel function importing `src/shared/recipe-scraper.ts`)
- Modify: `src/renderer/data/scrape.ts`, `pages/ImportPage.tsx`
- Create: `vercel.json` rewrite (already exists — verify it routes `/api/*`)

- [ ] **Step 1:** `api/scrape.ts`: read `?url=`, call `fetchAndExtract`, return JSON `{ ok, data }` or `{ ok:false, message }`; set permissive CORS for the Electron origin.
- [ ] **Step 2:** `scrape.ts`: `scrapeUrl` POSTs/GETs `import.meta.env.VITE_SCRAPE_URL ?? '/api/scrape'`.
- [ ] **Step 3:** Refactor `ImportPage.tsx` to call `scrapeUrl` from `../data/scrape`.
- [ ] **Step 4:** `npm run typecheck:web && npm run test:run` (scraper tests still cover the logic).
- [ ] **Step 5:** Commit: `git commit -am "feat: recipe scraping via /api/scrape serverless"`

### Task 9: Meal plan via Supabase

**Files:**
- Modify: `src/renderer/data/mealPlan.ts`, `pages/MealPlanPage.tsx`

- [ ] **Step 1:** Implement `mealPlan.ts`: `getMealPlan` → select all 7 days, fill missing; `setMeal` → upsert `(owner_id,day)` with `recipe_id`/`free_text` and a computed `meal_text` (recipe title or free text) for the bot; `clearWeek` → delete own rows.
- [ ] **Step 2:** Refactor `MealPlanPage.tsx` to use `mealPlan.ts`; remove the Discord bot warning banner / `window.api` calls; update the note to "syncs to the bot via the cloud (coming soon)".
- [ ] **Step 3:** `npm run typecheck:web`.
- [ ] **Step 4:** Commit: `git commit -am "feat: meal plan via Supabase (+ meal_text for bot)"`

### Task 10: Groceries via Supabase (replace Google Tasks)

**Files:**
- Modify: `src/renderer/data/groceries.ts`
- Create: `src/renderer/pages/GroceriesPage.tsx`
- Modify: `src/renderer/components/GroceryPreviewModal.tsx` (send to `addGroceries` instead of `sendGroceries`), `App.tsx`/`Sidebar.tsx` (add a Groceries nav item), `styles.css`

- [ ] **Step 1:** Implement `groceries.ts`: `listGroceries` ordered by `checked, sort_order`; `addGroceries(names)` bulk insert with incrementing `sort_order`; `toggleGrocery`; `clearChecked` delete where `checked`.
- [ ] **Step 2:** `GroceriesPage.tsx`: list with checkboxes, add-item input, "clear checked". Reuse `grocery-merge` for "send from recipes" (already in the preview modal).
- [ ] **Step 3:** Update `GroceryPreviewModal` to call `addGroceries(selected)` and drop the Google sign-in branch.
- [ ] **Step 4:** Add `'groceries'` to `Page`, Sidebar nav `{ page:'groceries', label:'Groceries', icon:'🛒' }`, render in `App.tsx`.
- [ ] **Step 5:** `npm run typecheck:web`.
- [ ] **Step 6:** Commit: `git commit -am "feat: built-in grocery list via Supabase (replaces Google Tasks)"`

### Task 11: Macro tracker via Supabase

**Files:**
- Modify: `src/renderer/data/foods.ts`, `tracker.ts`
- Test: `tests/data-tracker.test.ts` (computeTotals already covered; test daily grouping mapper)
- Modify: `pages/MacroTrackerPage.tsx`, `components/AddFoodModal.tsx`, `components/BarcodeScanner.tsx` (unchanged), `components/ProfileModal.tsx`

- [ ] **Step 1:** `foods.ts`: `searchFoods` = bundled `searchStaples` (from `src/shared/nutrition`) + OFF client-side fetch + map; `lookupBarcode` = check `food_cache` table → else OFF fetch → upsert cache. (CORS: OFF allows it; if blocked, route via `/api/off` — note in code.)
- [ ] **Step 2:** `tracker.ts`: `getProfile` selects/▶upserts the caller's `profiles` row (display_name from auth email); `updateGoals`; `getDailyLog(date)` selects `food_log` for `auth.uid()`+date, groups by meal, attaches `computeTotals` + the profile's goals; `addLogEntry`/`updateLogEntry`/`deleteLogEntry`.
- [ ] **Step 3:** Refactor `MacroTrackerPage.tsx`: remove the profile switcher + `getProfiles`/`setActiveProfile` (each auth user is one profile); load `getProfile()` for goals; date nav + meals + totals unchanged but via `tracker.ts`. `ProfileModal` becomes "Goals" (name + 4 goals; no delete/switch). `AddFoodModal` uses `foods.ts`.
- [ ] **Step 4:** `npm run typecheck:web && npm run test:run`.
- [ ] **Step 5:** Commit: `git commit -am "feat: macro tracker via Supabase (per-user profile + goals)"`

---

## Phase 3 — PWA, mobile UX, Electron slim-down, migration, deploy

### Task 12: Responsive layout + mobile nav

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`, `App.tsx`, `styles.css`

- [ ] **Step 1:** Add a CSS media query (`max-width: 720px`): hide the sidebar, show a fixed bottom nav (same NAV items as icons+labels); pages go single-column; add bottom padding so content clears the nav.
- [ ] **Step 2:** Ensure tap targets ≥ 44px; recipe grid uses `minmax(140px,1fr)` on mobile.
- [ ] **Step 3:** Verify in a narrow browser window (`npm run dev:web`).
- [ ] **Step 4:** Commit: `git commit -am "feat: responsive layout with mobile bottom nav"`

### Task 13: PWA icons + manifest verification

**Files:**
- Create: `public/pwa-192.png`, `public/pwa-512.png` (generate from `resources/recipe-vault.ico`/icon via `scripts/make-icon.js` or sharp)
- Verify: `vite.config.ts` manifest references them

- [ ] **Step 1:** Generate the two PNGs (192, 512) from the existing icon source with sharp.
- [ ] **Step 2:** `npm run build:web` → confirm `dist-web/manifest.webmanifest` + service worker emitted, icons present.
- [ ] **Step 3:** Commit: `git add -A && git commit -m "feat: PWA icons"`

### Task 14: Electron slim-down

**Files:**
- Modify: `src/main/index.ts` (remove DB init/IPC/google/bot init; keep window + camera permission)
- Delete: `src/main/ipc.ts`, `src/main/db.ts`, `src/main/google-tasks.ts`, `src/main/bot-mealplan-sync.ts`, `src/main/settings.ts`, `src/preload/index.ts` data API (preload now minimal/empty)
- Modify: `src/preload/index.d.ts` (drop `window.api` data types; keep nothing or a no-op)
- Modify: `electron.vite.config.ts` if needed; ensure renderer build injects `VITE_*` env

- [ ] **Step 1:** Slim `main/index.ts` to: create window, set camera permission handler, load renderer (dev URL or built file). Remove `initDatabase`/`persist`/`registerIpcHandlers`/google/settings.
- [ ] **Step 2:** Reduce preload to an empty/no-op bridge (no `window.api`); delete the obsolete main modules + their tests that no longer apply (keep shared-logic tests).
- [ ] **Step 3:** `npm run typecheck && npm run build` (desktop build green).
- [ ] **Step 4:** Commit: `git commit -am "refactor: slim Electron main to a Supabase-backed shell"`

### Task 15: One-time data migration script

**Files:**
- Create: `scripts/migrate-to-supabase.mjs`

- [ ] **Step 1:** Script: load `%APPDATA%/recipe-vault/recipe-vault.sqlite` via sql.js, sign in with `MIGRATE_EMAIL`/`MIGRATE_PASSWORD`, insert recipes + ingredients + steps (and optionally food_log) stamped with the user id, idempotent on title.
- [ ] **Step 2:** Document usage in the script header; do not run automatically.
- [ ] **Step 3:** Commit: `git add -A && git commit -m "feat: one-time SQLite→Supabase migration script"`

### Task 16: Env, deploy docs, final verification

**Files:**
- Modify: `.env.example` (already has the vars — verify), `README.md` (add mobile/deploy section)

- [ ] **Step 1:** Document the account-bound steps: create Supabase project → run `supabase/schema.sql` → enable email auth + add 2 users; Vercel: import repo, set `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`, build `npm run build:web` (output `dist-web`), functions in `/api`.
- [ ] **Step 2:** Full verification checklist (manual): sign in on desktop + phone, same data both, log a macro + scan a barcode on phone, import a recipe, build a grocery list, install PWA to home screen, second user isolation.
- [ ] **Step 3:** Commit: `git commit -am "docs: deploy + verification for mobile PWA"`

---

## Self-review notes

- **Spec coverage:** auth (T3–4), schema incl. tracker (T2), data layer (T6 + per-feature T7–11), scrape serverless (T8), groceries replace Google Tasks (T10), tracker per-user (T11), PWA/mobile (T12–13), Electron slim (T14), migration (T15), deploy (T16). Discord-bot rewrite intentionally out of scope (spec non-goal).
- **Types:** data-layer signatures in T6 match call-sites; `GroceryItem` defined once (T6) and used in T10.
- **Testing:** pure logic keeps its existing tests (relocated T5); data modules get mocked-supabase unit tests where logic is non-trivial (T7, T11); UI verified by typecheck/build + manual mobile pass (T16).
