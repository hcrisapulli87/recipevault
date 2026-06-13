# 🍳 RecipeVault

Recipe library + weekly meal planner. Paste any recipe URL and RecipeVault strips it down to
just the ingredients and steps — no ads, no life stories — then helps you plan the week and
send the shopping list to the household groceries.

## What it does

- **Import from URL** — parses schema.org JSON-LD (most recipe sites), falls back to heuristic
  HTML scanning, and always shows a review screen before saving.
- **Library** — searchable recipe cards with images and cook times.
- **Serving scaler** — bump 4 servings to 6 and every quantity rescales (with tidy fractions).
- **Cooking mode** — full-screen step-by-step view with big text for the kitchen.
- **Weekly meal plan** — Mon–Sun grid; assign saved recipes or free text.
- **Groceries** — "Send week to groceries" merges duplicate ingredients across recipes and
  pushes them to the **Groceries** Google Tasks list (the same one the Discord bot's
  `!groceries` and the phones use). Items already on the list are skipped.
- **Discord bot sync** — the weekly plan is written to the bot's `meal_plan.json`, so
  `!mealplan` and the Sunday-evening auto-post show it. Days set with `!setmeal` appear in the
  app too.

## Dev

```
npm install
npm run dev        # run with hot reload
npm run test:run   # vitest unit tests
npm run typecheck
npm run build:win  # package to dist/win-unpacked/
```

## Setup

1. **Google Tasks**: copy the household `google-credentials.json` (same OAuth client the
   nanoblock tracker uses) into `%APPDATA%\recipe-vault\`, then sign in from Settings.
2. **Discord bot**: Settings → bot folder should point at `discord-household-bot`. The bot's
   `meal_planner.py` re-reads `meal_plan.json` on each command, so no bot restart is needed
   after plan changes (the bot itself needs one restart after that change first lands).

## Architecture notes

- Electron + electron-vite + React + TypeScript + sql.js (database persisted to
  `%APPDATA%\recipe-vault\recipe-vault.sqlite`).
- Recipe scraping and ingredient parsing are pure functions in `src/main/recipe-scraper.ts`
  and `src/shared/ingredient-parser.ts` — tested against fixture HTML in `tests/fixtures/`.
- Grocery sends are **append-only** to Google Tasks (no reconcile loop); dedup is by
  ingredient name, so "Onions (3)" won't duplicate a bare "onions".
- Design spec: `docs/superpowers/specs/2026-06-13-recipe-vault-design.md`.
