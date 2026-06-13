# RecipeVault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desktop recipe library + weekly meal planner that scrapes any recipe URL down to ingredients/steps, sends groceries to the household Google Tasks list, and syncs the weekly plan to the Discord bot.

**Architecture:** Electron (electron-vite) main process owns SQLite (sql.js), the scraper, Google Tasks client, and the bot's shared `meal_plan.json`; React renderer talks over IPC. Scraper and ingredient parser are pure functions (testable without Electron).

**Tech Stack:** Electron + electron-vite + React + TypeScript + sql.js + vitest. No new runtime dependencies beyond the nanoblock-tracker set.

**Spec:** `docs/superpowers/specs/2026-06-13-recipe-vault-design.md`

**Reference project:** `C:\Users\Harrison Crisapulli\Documents\claudecode\nanoblock-tracker` (copy config shape, db/ipc/google-tasks patterns). Never copy launcher files or `resources/` — build fresh.

---

## File Structure

```
recipe-vault/
├── package.json, electron.vite.config.ts, tsconfig*.json, vitest.config.ts,
│   electron-builder.yml, .gitignore, .prettierrc.yaml, eslint.config.mjs   (Task 1)
├── src/shared/types.ts                  — Recipe, ParsedIngredient, DraftRecipe, IPC channel names
├── src/main/index.ts                    — app bootstrap, window, db load/persist (Task 2)
├── src/main/db.ts                       — schema + CRUD (Task 2)
├── src/main/ingredient-parser.ts        — pure parse/scale/format (Task 3)
├── src/main/recipe-scraper.ts           — pure HTML→DraftRecipe (Task 4), fetch wrapper (Task 5)
├── src/main/grocery-merge.ts            — pure merge of parsed ingredients (Task 9)
├── src/main/google-tasks.ts             — OAuth + append-only Groceries client (Task 10)
├── src/main/bot-mealplan-sync.ts        — shared meal_plan.json read/write (Task 8)
├── src/main/ipc.ts                      — handlers (grows across tasks)
├── src/preload/index.ts, index.d.ts     — API bridge
├── src/renderer/…                       — App shell + pages (Tasks 6,7,8,11)
└── tests/                               — vitest unit tests + fixtures/
```

---

### Task 1: Scaffold project

**Files:** Create all config files; `src/main/index.ts` stub, `src/preload/index.ts`, `src/renderer/{index.html,main.tsx,App.tsx,styles.css}`.

- [ ] **Step 1:** Copy these files from `nanoblock-tracker` into `recipe-vault`, then edit: `package.json` (name `recipe-vault`, productName `RecipeVault`, appId `com.harrisonc.recipe-vault`, remove `express`/`cookie-parser` deps — keep `sql.js`, `@electron-toolkit/*`), `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `eslint.config.mjs`, `.prettierrc.yaml`, `.prettierignore`, `.editorconfig`, `.gitignore`, `electron-builder.yml` (fix name/appId/output; keep the sql-wasm.wasm extraResources block).
- [ ] **Step 2:** Write minimal `src/main/index.ts` (BrowserWindow 1280×800, dark background `#16181d`, loads renderer per electron-vite convention — copy the window-creation shape from nanoblock-tracker `src/main/index.ts`, dropping the express/tunnel/ebay imports), empty-shell `App.tsx` rendering `<h1>RecipeVault</h1>`, and `src/renderer/styles.css` with the dark-theme CSS variables (copy palette from nanoblock-tracker `styles.css`).
- [ ] **Step 3:** Run `npm install` then `npm run dev`. Expected: window opens showing the shell.
- [ ] **Step 4:** Commit: `git add -A; git commit -m "chore: scaffold electron-vite project"`

### Task 2: Types, database schema, CRUD

**Files:** Create `src/shared/types.ts`, `src/main/db.ts`; modify `src/main/index.ts` (load/persist db like nanoblock-tracker does: read userData `recipe-vault.sqlite` into sql.js, write back on change/quit). Test: `tests/db.test.ts`.

- [ ] **Step 1:** Write `src/shared/types.ts`:

```ts
export interface ParsedIngredient {
  raw: string
  quantity: number | null
  quantityMax: number | null // upper bound for ranges like "1-2"
  unit: string | null
  name: string
}

export interface Recipe {
  id: number
  title: string
  sourceUrl: string | null
  imageUrl: string | null
  description: string
  servings: number | null
  prepMin: number | null
  cookMin: number | null
  totalMin: number | null
  createdAt: string
  ingredients: (ParsedIngredient & { position: number })[]
  steps: { position: number; section: string | null; text: string }[]
}

export type DraftRecipe = Omit<Recipe, 'id' | 'createdAt'> & { confidence: 'structured' | 'heuristic' | 'manual' }

export type Day = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
export const DAYS: Day[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export interface MealPlanEntry { day: Day; recipeId: number | null; freeText: string | null }

export const IPC = {
  GET_RECIPES: 'get-recipes', GET_RECIPE: 'get-recipe', SAVE_RECIPE: 'save-recipe',
  DELETE_RECIPE: 'delete-recipe', SCRAPE_URL: 'scrape-url',
  GET_MEAL_PLAN: 'get-meal-plan', SET_MEAL: 'set-meal', CLEAR_WEEK: 'clear-week',
  PREVIEW_GROCERIES: 'preview-groceries', SEND_GROCERIES: 'send-groceries',
  GOOGLE_STATUS: 'google-status', GOOGLE_SIGN_IN: 'google-sign-in',
  GET_SETTINGS: 'get-settings', SET_SETTINGS: 'set-settings',
} as const
```

- [ ] **Step 2:** Write failing `tests/db.test.ts` — in-memory sql.js db: `createSchema`, save a recipe with 2 ingredients + 2 steps via `saveRecipe`, read back with `getRecipe` and assert round-trip; `setMeal('monday', {recipeId})` then `getMealPlan()` returns 7 entries with monday set.
- [ ] **Step 3:** Run `npx vitest run tests/db.test.ts` — expected FAIL (module missing).
- [ ] **Step 4:** Implement `src/main/db.ts` following nanoblock-tracker `db.ts` style (prepared statements, `stmt.free()`): `createSchema` (tables `recipes`, `ingredients`, `steps`, `meal_plan` exactly per spec SQL), `getRecipes(db)` (summaries: id, title, imageUrl, totalMin), `getRecipe(db, id)` (joins ingredients+steps ordered by position), `saveRecipe(db, draft): number` (insert recipe + children in one transaction), `deleteRecipe(db, id)` (cascade children), `getMealPlan(db)`, `setMeal(db, day, recipeId, freeText)` (upsert), `clearWeek(db)`.
- [ ] **Step 5:** Run `npx vitest run tests/db.test.ts` — expected PASS.
- [ ] **Step 6:** Wire db load/persist in `src/main/index.ts` (copy nanoblock-tracker's initSqlJs + readFile/writeFile pattern, file `recipe-vault.sqlite` in userData; persist after each mutating IPC call). Create `src/main/ipc.ts` registering GET_RECIPES/GET_RECIPE/SAVE_RECIPE/DELETE_RECIPE/GET_MEAL_PLAN/SET_MEAL/CLEAR_WEEK against db.ts, and the preload bridge (`src/preload/index.ts` exposing `window.api.<camelCase>` per channel — copy nanoblock-tracker preload shape).
- [ ] **Step 7:** `npm run typecheck` then commit `feat: database schema, CRUD, IPC skeleton`.

### Task 3: Ingredient parser (pure)

**Files:** Create `src/main/ingredient-parser.ts`. Test: `tests/ingredient-parser.test.ts`.

- [ ] **Step 1:** Write failing tests:

```ts
import { describe, it, expect } from 'vitest'
import { parseIngredient, scaleIngredient, formatQuantity } from '../src/main/ingredient-parser'

describe('parseIngredient', () => {
  it('parses qty + unit + name', () =>
    expect(parseIngredient('2 cups flour')).toEqual(
      { raw: '2 cups flour', quantity: 2, quantityMax: null, unit: 'cup', name: 'flour' }))
  it('parses metric', () =>
    expect(parseIngredient('400g chopped tomatoes').unit).toBe('g'))
  it('parses unicode fraction', () =>
    expect(parseIngredient('½ onion, diced')).toMatchObject({ quantity: 0.5, unit: null, name: 'onion, diced' }))
  it('parses mixed number', () =>
    expect(parseIngredient('1 ½ tbsp olive oil').quantity).toBe(1.5))
  it('parses range', () =>
    expect(parseIngredient('1-2 cloves garlic')).toMatchObject({ quantity: 1, quantityMax: 2, unit: 'clove' }))
  it('handles unitless count', () =>
    expect(parseIngredient('3 eggs')).toMatchObject({ quantity: 3, unit: null, name: 'eggs' }))
  it('returns null quantity when unparseable', () =>
    expect(parseIngredient('salt and pepper to taste')).toMatchObject({ quantity: null, name: 'salt and pepper to taste' }))
})

describe('scaling + formatting', () => {
  it('scales linearly', () =>
    expect(scaleIngredient(parseIngredient('2 cups flour'), 1.5).quantity).toBe(3))
  it('formats nice fractions', () => {
    expect(formatQuantity(0.5)).toBe('½')
    expect(formatQuantity(1.5)).toBe('1 ½')
    expect(formatQuantity(3)).toBe('3')
    expect(formatQuantity(0.33)).toBe('⅓')
  })
})
```

- [ ] **Step 2:** Run `npx vitest run tests/ingredient-parser.test.ts` — expected FAIL.
- [ ] **Step 3:** Implement:

```ts
import type { ParsedIngredient } from '../shared/types'

const FRACTIONS: Record<string, number> = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 }
// singular canonical unit ← accepted variants
const UNITS: Record<string, string[]> = {
  g: ['g', 'gram', 'grams'], kg: ['kg'], ml: ['ml'], l: ['l', 'litre', 'litres', 'liter', 'liters'],
  tsp: ['tsp', 'teaspoon', 'teaspoons'], tbsp: ['tbsp', 'tablespoon', 'tablespoons'],
  cup: ['cup', 'cups'], oz: ['oz', 'ounce', 'ounces'], lb: ['lb', 'lbs', 'pound', 'pounds'],
  clove: ['clove', 'cloves'], can: ['can', 'cans'], tin: ['tin', 'tins'],
  slice: ['slice', 'slices'], pinch: ['pinch', 'pinches'], handful: ['handful', 'handfuls'],
}
const UNIT_LOOKUP = new Map(Object.entries(UNITS).flatMap(([c, vs]) => vs.map(v => [v, c] as const)))

function readNumber(s: string): { value: number; rest: string } | null {
  // "1 ½", "½", "1.5", "2"
  let m = s.match(/^(\d+)\s+([½⅓⅔¼¾⅕⅛⅜⅝⅞])\s*/)
  if (m) return { value: Number(m[1]) + FRACTIONS[m[2]], rest: s.slice(m[0].length) }
  m = s.match(/^([½⅓⅔¼¾⅕⅛⅜⅝⅞])\s*/)
  if (m) return { value: FRACTIONS[m[1]], rest: s.slice(m[0].length) }
  m = s.match(/^(\d+(?:\.\d+)?)(?:\s*|(?=[a-zA-Z]))/)
  if (m) return { value: Number(m[1]), rest: s.slice(m[0].length) }
  return null
}

export function parseIngredient(raw: string): ParsedIngredient {
  const base: ParsedIngredient = { raw, quantity: null, quantityMax: null, unit: null, name: raw.trim() }
  let s = raw.trim()
  const first = readNumber(s)
  if (!first) return base
  let quantityMax: number | null = null
  s = first.rest
  const range = s.match(/^[-–to]+\s*/)
  if (range) {
    const second = readNumber(s.slice(range[0].length))
    if (second) { quantityMax = second.value; s = second.rest }
  }
  const unitMatch = s.match(/^([a-zA-Z]+)\.?\s+/)
  let unit: string | null = null
  if (unitMatch && UNIT_LOOKUP.has(unitMatch[1].toLowerCase())) {
    unit = UNIT_LOOKUP.get(unitMatch[1].toLowerCase())!
    s = s.slice(unitMatch[0].length)
  }
  const name = s.replace(/^of\s+/i, '').trim()
  return { raw, quantity: first.value, quantityMax, unit, name: name || base.name }
}

export function scaleIngredient(ing: ParsedIngredient, factor: number): ParsedIngredient {
  if (ing.quantity === null) return ing
  return { ...ing, quantity: ing.quantity * factor, quantityMax: ing.quantityMax === null ? null : ing.quantityMax * factor }
}

const NICE: [number, string][] = [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']]
export function formatQuantity(n: number): string {
  const whole = Math.floor(n)
  const frac = n - whole
  if (frac < 0.05) return String(Math.round(n))
  const nearest = NICE.reduce((a, b) => (Math.abs(b[0] - frac) < Math.abs(a[0] - frac) ? b : a))
  if (Math.abs(nearest[0] - frac) > 0.05) return String(Math.round(n * 100) / 100)
  return whole === 0 ? nearest[1] : `${whole} ${nearest[1]}`
}
```

- [ ] **Step 4:** Run tests — expected PASS (adjust regexes until green; the tests are the contract).
- [ ] **Step 5:** Commit `feat: ingredient parser with scaling and fraction formatting`.

### Task 4: Recipe extraction from HTML (pure)

**Files:** Create `src/main/recipe-scraper.ts`. Test: `tests/recipe-scraper.test.ts` + `tests/fixtures/*.html`.

- [ ] **Step 1:** Create fixtures (commit them): `tests/fixtures/jsonld-simple.html` (single `<script type="application/ld+json">` with a Recipe: name, image string, recipeYield "4 servings", prepTime "PT15M", cookTime "PT30M", recipeIngredient array of 3, recipeInstructions as HowToStep array), `tests/fixtures/jsonld-graph.html` (Recipe nested inside `@graph`, instructions as HowToSection containing HowToSteps, image as ImageObject, `@type` as array `["Recipe","NewsArticle"]`), `tests/fixtures/no-jsonld.html` (plain page: `<ul class="recipe-ingredients"><li>…` and `<h2>Instructions</h2><ol><li>…`). Write each by hand — small, ~40 lines.
- [ ] **Step 2:** Write failing tests:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { extractRecipeFromHtml, parseIsoDuration } from '../src/main/recipe-scraper'

const fix = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf-8')

describe('parseIsoDuration', () => {
  it('parses PT1H30M', () => expect(parseIsoDuration('PT1H30M')).toBe(90))
  it('parses PT45M', () => expect(parseIsoDuration('PT45M')).toBe(45))
  it('returns null for junk', () => expect(parseIsoDuration('soon')).toBeNull())
})

describe('extractRecipeFromHtml', () => {
  it('extracts from simple JSON-LD', () => {
    const r = extractRecipeFromHtml(fix('jsonld-simple.html'))!
    expect(r.confidence).toBe('structured')
    expect(r.title).toBeTruthy()
    expect(r.servings).toBe(4)
    expect(r.prepMin).toBe(15)
    expect(r.ingredients.length).toBe(3)
    expect(r.steps.length).toBeGreaterThan(0)
  })
  it('extracts from @graph with sections', () => {
    const r = extractRecipeFromHtml(fix('jsonld-graph.html'))!
    expect(r.confidence).toBe('structured')
    expect(r.steps.some(s => s.section !== null)).toBe(true)
    expect(r.imageUrl).toMatch(/^https?:/)
  })
  it('falls back to heuristics', () => {
    const r = extractRecipeFromHtml(fix('no-jsonld.html'))!
    expect(r.confidence).toBe('heuristic')
    expect(r.ingredients.length).toBeGreaterThan(0)
    expect(r.steps.length).toBeGreaterThan(0)
  })
  it('returns null for a page with nothing', () =>
    expect(extractRecipeFromHtml('<html><body><p>hi</p></body></html>')).toBeNull())
})
```

- [ ] **Step 3:** Run — expected FAIL.
- [ ] **Step 4:** Implement `extractRecipeFromHtml(html): DraftRecipe | null`:
  - Collect JSON-LD blocks with `/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi`, `JSON.parse` each (try/catch, skip bad), and search recursively (arrays + `@graph`) for a node whose `@type` equals or includes `"Recipe"`.
  - Normalisers: `asText(v)` (string | {…"@type":"HowToStep", text}), `firstImage(v)` (string | string[] | ImageObject | ImageObject[]), `parseIsoDuration(v): number|null` (`/^PT(?:(\d+)H)?(?:(\d+)M)?/`), `parseYield(v): number|null` (first integer in string/array/number).
  - Instructions: strings → steps; HowToStep → step; HowToSection → its `itemListElement` steps with `section = section.name`. Strip HTML tags and decode common entities (`&amp;` `&#39;` `&quot;` `&nbsp;`) from all text.
  - Ingredients: map `recipeIngredient` strings through `parseIngredient` (Task 3) with `position`.
  - Heuristic fallback: (a) microdata `itemprop="recipeIngredient"` element contents; (b) `<li>` items inside any element whose class matches `/ingredient/i`; steps from the first `<ol>` following a heading matching `/instructions|method|directions/i`, else `<li>` inside class `/instruction|method|direction|step/i`. Title from `<meta property="og:title">` else `<title>`. Image from `og:image`. Return `confidence: 'heuristic'`; if no ingredients AND no steps found, return `null`.
  - Use regex/string scanning only — no DOM library (keeps it dependency-free like the nanoblock scraper).
- [ ] **Step 5:** Run tests — expected PASS.
- [ ] **Step 6:** Commit `feat: recipe extraction (JSON-LD + heuristic fallback)`.

### Task 5: Scrape IPC (fetch wrapper)

**Files:** Modify `src/main/recipe-scraper.ts` (add `fetchAndExtract`), `src/main/ipc.ts`, preload.

- [ ] **Step 1:** Add to recipe-scraper.ts:

```ts
export class ScrapeError extends Error {}

export async function fetchAndExtract(url: string): Promise<DraftRecipe> {
  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'text/html' } })
  } catch {
    throw new ScrapeError('Could not reach that site. Check the URL and your connection.')
  }
  if (!res.ok) throw new ScrapeError(`The site refused the request (HTTP ${res.status}).`)
  const draft = extractRecipeFromHtml(await res.text())
  if (!draft) throw new ScrapeError('No recipe found on that page. You can enter it manually.')
  if (!draft.sourceUrl) draft.sourceUrl = url
  return draft
}
```

- [ ] **Step 2:** Register `IPC.SCRAPE_URL` in ipc.ts with the `{ok,data}|{ok:false,message}` envelope (same shape as nanoblock-tracker's FETCH_EBAY_PRICES handler); expose `api.scrapeUrl(url)` in preload + `index.d.ts`.
- [ ] **Step 3:** `npm run typecheck`; manual check in dev: `await window.api.scrapeUrl('https://www.bbcgoodfood.com/recipes/spaghetti-bolognese-recipe')` from devtools console returns ok with ingredients.
- [ ] **Step 4:** Commit `feat: scrape-url IPC with friendly errors`.

### Task 6: App shell, Library, Import flow UI

**Files:** Create `src/renderer/App.tsx` (replace stub), `components/Sidebar.tsx`, `pages/LibraryPage.tsx`, `pages/ImportPage.tsx`, `components/RecipeReviewForm.tsx`, `hooks/useRecipes.ts`; extend `styles.css`.

- [ ] **Step 1:** `App.tsx`: `useState<'library'|'plan'|'import'|'settings'>` page switcher + `selectedRecipeId` state; Sidebar with 4 nav items (same pattern as nanoblock-tracker `App.tsx`/`Sidebar.tsx`). Dark theme: reuse the CSS variable palette.
- [ ] **Step 2:** `useRecipes` hook: `recipes`, `reload()`, `save(draft)`, `remove(id)` over `window.api`. `LibraryPage`: search input filtering by title (client-side, `toLowerCase().includes`), responsive card grid — image (fallback: 🍽️ emoji block), title, total time chip. Click → detail (Task 7); "+ Import recipe" button → import page.
- [ ] **Step 3:** `ImportPage`: URL input + "Fetch recipe" → loading state → on ok render `RecipeReviewForm` with the draft; on error show the message + "Enter manually" button (opens the form blank with `confidence:'manual'`). `RecipeReviewForm`: editable title, description, servings, times; ingredients as editable text lines (re-parsed on save); steps as editable textareas with add/remove/reorder (up/down buttons — no drag-and-drop); confidence banner ("Parsed from structured data" green / "Best-effort parse — please check" amber). Save → `api.saveRecipe` → navigate to library.
- [ ] **Step 4:** Run `npm run dev`; import a real URL end-to-end; save; card appears in library. `npm run typecheck`.
- [ ] **Step 5:** Commit `feat: library and URL import flow`.

### Task 7: Recipe detail, serving scaler, cooking mode

**Files:** Create `pages/RecipeDetailPage.tsx`, `components/CookingMode.tsx`.

- [ ] **Step 1:** Detail page: hero (image, title, time chips, source link via `shell.openExternal` pattern — expose `api.openExternal` if not present), servings stepper (− / count / +, default `recipe.servings ?? 1`), ingredient list rendering `formatQuantity(scaled)` + unit + name (raw text when quantity null) — import scaling/formatting helpers from a small `src/renderer/lib/quantity.ts` that re-exports the pure functions (renderer-safe, no Node imports — move shared pure code to `src/shared/` if cleaner), numbered steps grouped by section. Buttons: "Cook", "Send ingredients to groceries" (Task 11), "Delete" (confirm dialog).
- [ ] **Step 2:** `CookingMode`: full-screen overlay, one large card per step ("Step 3 of 8" + section name), big text (≥1.4rem), Previous/Next + click-to-check steps, Esc/✕ to exit. Pure renderer state.
- [ ] **Step 3:** Manual verify in dev: scale 4→6 servings, quantities re-render as fractions; cooking mode navigates. `npm run typecheck`.
- [ ] **Step 4:** Commit `feat: recipe detail with serving scaler and cooking mode`.

### Task 8: Meal plan grid + bot file sync

**Files:** Create `src/main/bot-mealplan-sync.ts`, `pages/MealPlanPage.tsx`, `hooks/useMealPlan.ts`; modify `ipc.ts`, preload, `src/main/index.ts` (settings store). Test: `tests/bot-mealplan-sync.test.ts`. **Also modify (other project):** `discord-household-bot/meal_planner.py`.

- [ ] **Step 1:** Settings store in main: JSON file `settings.json` in userData — `{ botFolder: string, groceriesList: string }` defaulting to `C:\Users\Harrison Crisapulli\Documents\claudecode\discord-household-bot` and `"Groceries"`. IPC GET_SETTINGS/SET_SETTINGS.
- [ ] **Step 2:** Write failing `tests/bot-mealplan-sync.test.ts` using a temp dir: `writeBotPlan(dir, entries, titleOf)` writes `meal_plan.json` mapping each day to the linked recipe's title, free text, or `""`; `readBotPlan(dir)` returns the day→string map; `mergeBotPlan(local, botMap)` — for each day, if bot string differs from what local would export, override local with `{recipeId:null, freeText: botString}` (empty string clears); missing file → `null` and no merge. Run — FAIL.
- [ ] **Step 3:** Implement `bot-mealplan-sync.ts` (pure functions + fs, ~50 lines). All writes atomic (write temp file, rename). Run tests — PASS.
- [ ] **Step 4:** Wire into ipc.ts: GET_MEAL_PLAN merges bot file before returning (and persists merged result to SQLite); SET_MEAL/CLEAR_WEEK write SQLite then export to bot file (non-blocking try/catch — on failure return `{ok:true, warning:'Could not write to bot folder'}`).
- [ ] **Step 5:** `MealPlanPage`: 7 rows (Monday–Sunday), each showing the assigned recipe title (link to detail) or free text; per-row controls: searchable recipe dropdown (filtered `<input>` + list), free-text input, clear button; header: "Clear week" + "Send week to groceries" (Task 11). Show the IPC `warning` as a dismissible banner when present.
- [ ] **Step 6:** Modify `discord-household-bot/meal_planner.py` — add `self.plan = self._load()` as the first line of `set_meal`, `clear_meal`, `get_plan`, and `get_weekly_post` (4 one-line additions; file is loaded fresh so app-side writes appear without bot restart).
- [ ] **Step 7:** Manual verify: set Monday in app → `meal_plan.json` updated; edit the file by hand (simulating `!setmeal`) → app grid shows it after refresh. `npm run typecheck`.
- [ ] **Step 8:** Commit recipe-vault (`feat: weekly meal plan with discord bot file sync`); commit the bot change separately in its folder (`fix: reload meal plan from disk on each command for RecipeVault sync`).

### Task 9: Grocery merge (pure)

**Files:** Create `src/main/grocery-merge.ts`. Test: `tests/grocery-merge.test.ts`.

- [ ] **Step 1:** Write failing tests:

```ts
import { describe, it, expect } from 'vitest'
import { mergeIngredients, groceryTitle, normaliseName } from '../src/main/grocery-merge'
import { parseIngredient } from '../src/main/ingredient-parser'

it('sums matching units', () => {
  const m = mergeIngredients([parseIngredient('2 onions'), parseIngredient('1 onion')])
  expect(m).toHaveLength(1)
  expect(m[0]).toMatchObject({ name: 'onion', parts: [{ quantity: 3, unit: null }] })
})
it('keeps mismatched units separate within one item', () => {
  const m = mergeIngredients([parseIngredient('200g flour'), parseIngredient('1 cup flour')])
  expect(m).toHaveLength(1)
  expect(m[0].parts).toHaveLength(2)
})
it('passes through unparseable lines', () => {
  const m = mergeIngredients([parseIngredient('salt to taste')])
  expect(m[0].parts).toEqual([])
})
it('builds titles', () => {
  expect(groceryTitle({ name: 'onion', parts: [{ quantity: 3, unit: null }] })).toBe('Onion (3)')
  expect(groceryTitle({ name: 'flour', parts: [{ quantity: 200, unit: 'g' }, { quantity: 1, unit: 'cup' }] })).toBe('Flour (200 g + 1 cup)')
  expect(groceryTitle({ name: 'salt to taste', parts: [] })).toBe('Salt to taste')
})
it('normalises for dedup', () => {
  expect(normaliseName('Onions ')).toBe(normaliseName('onion'))
})
```

- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement: `normaliseName` (lowercase, trim, strip trailing `s` when length > 3, collapse whitespace); `MergedItem = { name: string; parts: { quantity: number; unit: string | null }[] }`; group by normalised name keeping the first-seen display name; sum quantities per unit; `groceryTitle` capitalises first letter and formats quantities with `formatQuantity`. ~40 lines.
- [ ] **Step 4:** Run — PASS. Commit `feat: grocery merge logic`.

### Task 10: Google Tasks client

**Files:** Create `src/main/google-tasks.ts` (adapt `nanoblock-tracker/src/main/google-tasks-sync.ts`); modify `ipc.ts`, preload.

- [ ] **Step 1:** Copy the nanoblock module and strip it down: **keep** auth (credentialsPath/tokenPath/loadClient/exchangeToken/refresh/loopback sign-in flow, SCOPE `https://www.googleapis.com/auth/tasks`), `api()` fetch helper, list-id lookup-or-create; **delete** the mirror/reconcile/debounce machinery, CATALOG import, db references. List title comes from settings (`groceriesList`, default "Groceries") instead of the constant.
- [ ] **Step 2:** Add the two public functions:

```ts
export async function listPending(listTitle: string): Promise<{ id: string; title: string }[]>
export async function addGroceries(listTitle: string, titles: string[]): Promise<{ added: number; skipped: number }>
// addGroceries: fetch pending once; skip any title whose normaliseName(name-part) — text before " (" —
// matches a pending task's normalised name-part; POST the rest.
```

- [ ] **Step 3:** IPC: `GOOGLE_STATUS` (signed-in? credentials file present?), `GOOGLE_SIGN_IN` (runs loopback flow, returns ok/error), both with the envelope shape. Preload exposure + `index.d.ts`.
- [ ] **Step 4:** Manual verify: put the shared `google-credentials.json` into the app's userData folder, sign in from Settings (Task 11 builds the UI — for now trigger from devtools), confirm token file created.
- [ ] **Step 5:** Commit `feat: google tasks client (append-only groceries)`.

### Task 11: Grocery send flow + Settings page

**Files:** Create `components/GroceryPreviewModal.tsx`, `pages/SettingsPage.tsx`; modify `ipc.ts`, `RecipeDetailPage.tsx`, `MealPlanPage.tsx`.

- [ ] **Step 1:** IPC `PREVIEW_GROCERIES` (input: `{ recipeIds: number[], scales: Record<number, number> }`): load each recipe's ingredients, apply `scaleIngredient`, run `mergeIngredients`, return `MergedItem[] + groceryTitle` strings. IPC `SEND_GROCERIES` (input: selected titles): call `addGroceries`, return `{added, skipped}`.
- [ ] **Step 2:** `GroceryPreviewModal`: checklist of titles, all ticked; untick to exclude; footer "Add N items to Groceries" → on success toast "Added X items, skipped Y already on the list"; if GOOGLE_STATUS says signed-out, the footer button reads "Sign in to Google first" and triggers sign-in then retries. Wire "Send ingredients" (detail page, current scale) and "Send week to groceries" (plan page, scale 1 per recipe unless a per-day scale is stored — v1: always the recipe's saved servings).
- [ ] **Step 3:** `SettingsPage`: Google section (credentials-file presence, sign in/out, status), bot folder path input with existence check (warning icon when missing), groceries list name input. All persisted via SET_SETTINGS.
- [ ] **Step 4:** End-to-end manual verify: plan two recipes sharing an ingredient → "Send week" → preview shows merged quantities → send → items in Google Tasks phone app and `!groceries` on Discord; re-send → skipped count reported.
- [ ] **Step 5:** Commit `feat: grocery send with preview and settings page`.

### Task 12: Launcher + polish pass

**Files:** Create `launch-recipe-vault.vbs`, desktop shortcut, `resources/icon.ico`; `README.md`.

- [ ] **Step 1:** `npm run build:win` (or run from `npm start` via launcher in dev style matching other projects). Create a **fresh** `.vbs` launcher pointing at this project's path (do not copy a sibling's), a new `.ico` (unique filename — Explorer icon-cache rule), and a desktop shortcut targeting the exe/launcher directly.
- [ ] **Step 2:** README: what it is, dev commands, Google credentials setup (copy `google-credentials.json` to `%APPDATA%\recipe-vault\`), bot-sync note.
- [ ] **Step 3:** Full verification sweep per spec: `npx vitest run` (all green), `npm run typecheck`, then the end-to-end list from the spec's Verification section.
- [ ] **Step 4:** Commit `chore: launcher, icon, readme`.

---

## Self-review notes

- Every spec section maps to a task: import→4/5/6, parser/scaler→3/7, cooking mode→7, meal plan→8, merge→9, Tasks auth→10, send→11, bot change→8 step 6, errors→5/8/11, verification→12.
- Renderer never imports Node-only modules; pure helpers shared via `src/shared/` or renderer-safe re-export (Task 7 step 1 flags this).
- `formatQuantity`/`parseIngredient` names used consistently across Tasks 3, 7, 9.
