# RecipeVault — Recipe & Meal Planning App Design

**Date:** 2026-06-13
**Status:** Approved

## Context

A desktop app for recipes and meal planning. Paste any recipe URL and the app strips it down to just the ingredients and steps — no life stories, no ads — saves it to a searchable library, and lets you build a weekly meal plan. Planned ingredients land on the household groceries list (Google Tasks, shared with the Discord bot and phones), and the weekly plan shows up in the Discord household bot's `!mealplan` and Sunday 7 PM auto-post.

### Decisions made during brainstorming

| Decision | Choice | Why |
|---|---|---|
| Groceries integration | Direct to Google Tasks "Groceries" list | The bot's groceries are already backed by that list (`google_tasks.py`, `GROCERIES_LIST = "Groceries"`); writing to it directly means items appear in `!groceries` and on phones with no bot coupling. Matches the app-native sync rule. |
| Meal plan shape | Mon–Sun weekly grid, one active week | Matches the bot's existing model; household-scale simplicity. |
| Scrape fallback | JSON-LD first, heuristic HTML second, always a review screen | ~90% of recipe sites embed schema.org/Recipe JSON-LD for Google search cards. No API keys, works offline once fetched. |
| v1 extras | Serving scaler, cooking mode, smart grocery merge, bot meal-plan sync | All selected. |

## Project

- **Folder:** `C:\Users\Harrison Crisapulli\Documents\claudecode\recipe-vault`
- **Name:** RecipeVault
- **Stack:** Electron + electron-vite + React + TypeScript + sql.js SQLite (house convention — same scaffold shape as nanoblock-tracker/cinevault), dark theme.
- Launcher files and `resources/` built fresh for this project — never copied from siblings (known wrong-target/wrong-icon hazard).

## Architecture

```
Main process (Node)
├── db.ts                 — sql.js SQLite, persisted to userData (pattern: nanoblock-tracker/src/main/db.ts)
├── recipe-scraper.ts     — fetch URL → JSON-LD parse → heuristic fallback → draft recipe
├── ingredient-parser.ts  — "2 cups flour" → {quantity, unit, name, raw}
├── google-tasks-sync.ts  — adapted from nanoblock-tracker/src/main/google-tasks-sync.ts
│                           (loopback OAuth, dependency-free fetch; append-only to list "Groceries")
├── bot-mealplan-sync.ts  — reads/writes the bot's meal_plan.json (shared-file contract)
└── ipc.ts                — IPC handlers

Renderer (React)
├── Library page          — recipe cards (image, title, total time), title search
├── Import page           — URL input → scraped draft → review/edit → save
├── Recipe detail         — ingredients + steps, serving scaler, "Send to groceries", "Cook"
├── Cooking mode          — full-screen step-by-step, large text, checkable steps
├── Meal plan page        — Mon–Sun grid; assign saved recipe or free text per day;
│                           "Send week to groceries"
└── Settings              — Google sign-in, bot folder path, groceries list name
```

Each main-process module has one purpose and a narrow interface; the scraper and ingredient parser are pure functions over fetched HTML/strings, so they are unit-testable without Electron.

## Data model (SQLite via sql.js)

```sql
recipes(id, title, source_url, image_url, description,
        servings INTEGER, prep_min, cook_min, total_min, created_at)

ingredients(id, recipe_id, position, raw_text,
            quantity REAL NULL, unit TEXT NULL, name TEXT)   -- parsed once at import

steps(id, recipe_id, position, section TEXT NULL, text)

meal_plan(day TEXT PRIMARY KEY,        -- 'monday'..'sunday'
          recipe_id INTEGER NULL,      -- linked recipe, or…
          free_text TEXT NULL)         -- …plain meal name (incl. bot-side !setmeal entries)
```

All recipe metadata is auto-captured from the scrape (image, times, servings) — no optional manual fields, per the no-dead-weight rule.

## Feature specs

### 1. URL import

1. User pastes a URL; the main process fetches the HTML with Node's global `fetch` and a browser User-Agent header (many recipe sites 403 bare clients).
2. **JSON-LD pass:** find every `<script type="application/ld+json">`, locate the object with `@type: "Recipe"` (handling arrays, `@graph` wrappers, and `@type` arrays). Extract:
   - `name`, `image` (string | array | ImageObject), `description`
   - `recipeYield` → integer servings (first number found)
   - `prepTime` / `cookTime` / `totalTime` — ISO-8601 durations → minutes
   - `recipeIngredient[]` → ingredient strings
   - `recipeInstructions[]` — plain strings, `HowToStep`s, or `HowToSection`s (sections become step group headers)
3. **Heuristic fallback** when no JSON-LD Recipe exists: microdata `itemprop="recipeIngredient"` / `itemprop="recipeInstructions"`, then class-name matching (list items under elements with class matching `/ingredient/i`; ordered lists following an "Instructions" / "Method" / "Directions" heading).
4. **Review screen (always shown):** editable title, ingredient list, and steps, with a confidence note — "parsed from structured data" vs "best-effort parse — please check". Saving writes to SQLite and parses each ingredient line.
5. **Total failure:** clear error plus an "enter manually" path that opens the same review screen blank. Manual entry is the fallback, never the primary flow.

### 2. Ingredient parsing & serving scaler

- Parse each ingredient string into `{quantity, unit, name}`: leading numbers, unicode fractions (½ ¼ ¾ ⅓ ⅔ ⅛…), mixed numbers ("1 ½"), ranges ("1-2" → preserved as range), common units (g, kg, ml, l, tsp, tbsp, cup, oz, lb, clove, can, tin…). Unparseable lines get `quantity NULL` and display as raw text — graceful, never blocking.
- Recipe detail has a servings stepper defaulting to the scraped `servings`. Quantities scale linearly and render as tidy fractions (1.5 → "1 ½"). `raw_text` is always preserved; scaling is presentation-only and also applies to grocery sends.

### 3. Meal plan grid

- One active week, Monday–Sunday. Each day: pick a saved recipe via searchable dropdown, or type free text. Per-day clear and a "clear week" button.
- On page load and before every write, re-read the bot's `meal_plan.json` and merge bot-side changes (a day set via `!setmeal` appears as free text). Last writer wins per day — fine at household scale.

### 4. Grocery send (smart merge)

- **Per recipe:** "Send ingredients to groceries". **Per week:** "Send week to groceries" — all planned recipes at their current serving scale.
- **Merge:** group by normalised ingredient name (lowercase, trimmed, naive singularised); sum quantities when units match (2 onions + 1 onion → 3 onions); when units differ, keep both on one line ("flour (200 g + 1 cup)").
- **Preview checklist before sending:** everything ticked by default; user unticks pantry staples (salt, oil) per send. No persisted staples list — that would be dead-weight manual config.
- Push to the Google Tasks list **"Groceries"** with titles like `Onions (3)` / `Flour (200 g)`. Dedup by **name part** against pending tasks (the bot dedups by exact title, so quantity-suffixed titles need name-level matching to avoid duplicating a bare "onions").
- Result toast: "Added 14 items, skipped 3 already on the list."

### 5. Discord bot meal-plan sync (shared-file contract)

- The app writes `{"monday": "Spaghetti Bolognese", ..., "sunday": ""}` to `<bot folder>\meal_plan.json` — exactly the format `meal_planner.py` already uses. Bot folder path lives in Settings, defaulting to `C:\Users\Harrison Crisapulli\Documents\claudecode\discord-household-bot`.
- **Small bot change required:** `MealPlanner` loads the file once at startup and serves from memory. Add `self.plan = self._load()` at the top of `set_meal`, `clear_meal`, `get_plan`, and `get_weekly_post` so app-side writes appear in `!mealplan` and the Sunday 7 PM auto-post without a bot restart (and bot-side writes never clobber app writes from a stale snapshot).
- Failure isolation: the bot is fully functional if the app never runs; the app shows a non-blocking Settings warning if the path is missing and keeps the plan locally.

### 6. Google Tasks auth

- Adapt `nanoblock-tracker/src/main/google-tasks-sync.ts`: loopback OAuth over a localhost HTTP listener, token stored in userData, silent refresh. The user copies the same Google Cloud OAuth client file (`google-credentials.json`) into the app's userData folder, as with the nanoblock tracker. Scope: `https://www.googleapis.com/auth/tasks`.
- Unlike the nanoblock mirror-sync, this app only **appends** tasks — no reconcile loop, no debounced re-sync.

## Error handling

- **Scrape:** network failure / 403 / no recipe found → specific error message + manual-entry fallback.
- **Google Tasks:** not signed in → preview still works, the send button prompts sign-in; API errors → toast with retry; never partial-silent (report added/skipped/failed counts).
- **Bot file:** missing or locked → non-blocking warning; meal planning continues locally.

## Out of scope (v1)

- Date-based calendar / meal-plan history
- Tags, ratings, nutrition data
- AI-based extraction
- Pantry inventory tracking

## Verification

- **Unit (vitest):** ingredient parser (fractions, mixed numbers, ranges, unitless lines) and JSON-LD/heuristic extraction against saved fixture HTML from 3–4 real sites (BBC Good Food, AllRecipes, a plain blog).
- **End-to-end:** `npm run dev`; import a real recipe URL → verify ingredients/steps; scale servings; plan a week; send to groceries → items appear in the Google Tasks phone app **and** `!groceries` on Discord; set a meal in the app → `!mealplan` shows it (after the bot reload change), and `!setmeal` shows up in the app grid.
