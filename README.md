# 🍳 RecipeVault

Recipe library + weekly meal planner + macro tracker. Paste any recipe URL and RecipeVault
strips it down to just the ingredients and steps — no ads, no life stories — then helps you
plan the week, build the grocery list, and log what you ate.

Runs as **two builds of the same app**: an Electron desktop app and an installable mobile
web app (PWA), both talking to one Supabase database — sign in with the same email anywhere
and everything stays in sync.

## What it does

- **Import from URL** — parses schema.org JSON-LD (most recipe sites), falls back to heuristic
  HTML scanning, and always shows a review screen before saving.
- **Import from Instagram** — paste a reel link; the caption's recipe is parsed (or its blog
  link followed through the normal importer). On the phone the link queues through Supabase
  and the desktop app fetches it. See "Instagram import" below.
- **Library** — searchable recipe cards with images and cook times.
- **Serving scaler** — bump 4 servings to 6 and every quantity rescales (with tidy fractions).
- **Cooking mode** — full-screen step-by-step view with big text for the kitchen.
- **Weekly meal plan** — Mon–Sun grid; assign saved recipes or free text. Each day also gets a
  denormalised `meal_text` column the Discord bot can read straight from Supabase.
- **Household sharing** — one shared recipe library (recipes show who added them; only the
  owner can delete), and a Me/partner switcher on the Meal Plan and Tracker pages for a
  read-only view of each other's week and macros. Groceries stay private. Enforced by
  Postgres RLS ("read all, write only your own"), not just hidden buttons.
- **Groceries** — built-in checklist; "Send week to groceries" merges duplicate ingredients
  across recipes before adding them.
- **Macro tracker** — per-day food log (search a bundled staples list + OpenFoodFacts
  ranked Australia-first via `api/food-search.ts` — brands work as plain text, e.g.
  "tip top bread" — scan a barcode with the camera, or enter manually; a product the
  database doesn't know can be added once and is cached per-user for future scans)
  with daily calorie/protein/carb/fat goals.

## Architecture

- **One renderer, two shells.** `src/renderer` is built by Vite (+ `vite-plugin-pwa`) into the
  web app in `dist-web/`, and by electron-vite into the desktop app. The Electron main process
  is a window + camera permission + one IPC channel (the local Instagram fetcher) — no local
  database.
- **Supabase** (Postgres + email/password Auth + Realtime) holds all data. Row-Level Security keeps
  each user's rows private; the publishable key is safe in the browser. Schema:
  `supabase/schema.sql` (idempotent — safe to re-run).
- **Scraping** runs in a Vercel serverless function (`api/scrape.ts`) because browsers can't
  fetch cross-origin recipe pages; the parser itself is pure code in `src/shared/`, tested
  against fixture HTML in `tests/fixtures/`.

## Dev

```
npm install
npm run dev:web    # web app with hot reload (needs .env — see below)
npm run dev        # Electron desktop with hot reload
npm run test:run   # vitest unit tests
npm run typecheck
npm run build:web  # PWA to dist-web/
npm run build:win  # desktop to dist/win-unpacked/
```

## Instagram import (desktop)

Importing from Instagram reels uses a locally installed [yt-dlp](https://github.com/yt-dlp/yt-dlp):

```
pip install --user yt-dlp
```

Instagram blocks datacenter IPs, so reel fetching only runs in the desktop app (home
connection). Phone imports queue through Supabase (`import_queue` table) and are fetched
next time the desktop app is open. If Instagram imports suddenly fail, update it:
`pip install -U yt-dlp`.

## Deploy (one-time setup)

1. **Supabase** — create a project, then run `supabase/schema.sql` in the SQL Editor.
   Authentication → Sign In / Up: disable "Allow new users to sign up", keep Email enabled,
   and add each user with their password (tick "Auto Confirm User"). Sign-in is email +
   password; "Forgot password?" sends a reset email that opens the deployed web app.
2. **Env** — copy `.env.example` to `.env` and fill in the project URL + publishable key
   (Project Settings → API). `.env` stays gitignored.
3. **Vercel** — import the GitHub repo. Build command `npm run build:web`, output directory
   `dist-web`; the `/api` folder deploys as serverless functions automatically. Set
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Project → Settings →
   Environment Variables.
4. **Phone** — open the Vercel URL, sign in with email + password, then "Add to Home
   Screen" to install the PWA.
5. **Old data** — to bring recipes over from the pre-cloud desktop app, run
   `scripts/migrate-to-supabase.mjs` once (usage in the script header).

## Verification checklist (manual)

- [ ] Sign in on desktop and phone with the same email — same recipes on both.
- [ ] Import a recipe from a URL (exercises `/api/scrape`).
- [ ] Send a week to groceries; tick items off on the phone, watch desktop update.
- [ ] Log a food by search and by barcode scan on the phone.
- [ ] Install the PWA to the home screen; icon and standalone window look right.
- [ ] Sign in as the second user — their groceries are their own, but both users' recipes
      appear in the library ("added by" chip on the other person's, no Delete button).
- [ ] Me/partner switcher on Plan + Tracker shows the other person's week and macros,
      read-only, updating live as they log.

## Docs

- Mobile/PWA migration spec: `docs/superpowers/specs/2026-06-29-recipevault-mobile-pwa-migration-design.md`
- Original design spec: `docs/superpowers/specs/2026-06-13-recipe-vault-design.md`
