# RecipeVault Roadmap

Prioritised feature backlog, ordered most → least useful. Agreed with Harrison
2026-07-06 after the Instagram-import and AU-food-search releases. Each item
gets its own spec → plan → implementation cycle when picked up; sizes are
honest guesses (S ≈ an evening, M ≈ a day or two, L ≈ several days).

Ranking principle (house rules): features must run on data the app already
captures automatically — nothing that depends on optional manual upkeep.
That's why there is no pantry/inventory item here, deliberately.

---

## 1. Plan → Tracker macro bridge  (M–L) — the headliner

**What:** (a) Estimated macros per serving on every recipe ("~620 kcal ·
P42/C58/F18 per serve"), computed by matching parsed ingredients against the
bundled staples + OpenFoodFacts (via the new `api/food-search.ts`). Shown on
recipe cards + detail, labelled as an estimate (best-guess rule). (b) One-tap
**"Log this"** on today's meal-plan slots — the planned recipe lands in the
tracker as a single entry with those macros, portion adjustable.

**Why first:** it connects all three pillars (recipes, plan, tracker) into one
workflow — import reel → plan week → tap to log — and removes the app's
biggest daily friction: re-entering food the app already knows. Every day of
use benefits.

**Watch out:** ingredient→nutrition matching is heuristic (unit conversion,
"1 onion" → grams). Cache matches per ingredient; let the estimate be
editable/overridable on the recipe. Phase (a) ships value alone; (b) follows.

## 2. Tracker trends view  (S–M)

**What:** A history tab on the tracker: 7/30-day calorie + protein averages
vs goals, adherence streaks, per-day sparkline/bars (CSS/SVG, no chart lib),
best/worst days. Pure read view over the existing `food_log` — zero new data
entry.

**Why second:** the goal calculator set targets; this is what makes targets
meaningful over time. Weekly-review value for both household members, free of
input cost. Natural companion to #1 (planned macros vs actual).

## 3. Discord bot meal-plan sync  (S–M, cross-repo)

**What:** The household bot reads the week from Supabase (`meal_plan.meal_text`
was denormalised for exactly this) and posts "🍽️ Tonight: …" daily plus the
weekly overview — replacing the bot's own `meal_plan.json` commands as the
source of truth. Needs the 3-meals-per-day format bot-side, and auth: create a
dedicated bot login (email/password auth user, supabase-py, publishable key)
so RLS still applies — no service-role key in the bot.

**Why third:** closes the "Discord bot sync coming soon" promise the UI has
made for weeks; makes the plan visible where the household already talks.
Ranked below 1–2 only because the info is already accessible in the PWA.

## 4. Meal-plan memory + quick-fill  (M)

**What:** Stop losing history on "Clear week": archive filled weeks (small
`meal_plan_history` table or soft snapshot on clear/rollover). Then: slot
suggestions while planning (recently cooked, most-cooked favourites) and a
"copy last week" quick-fill.

**Why fourth:** makes Sunday planning faster and answers "what did we eat
last month?" — but it's an accelerator for a flow that already works.

## 5. Cooking-mode timers  (S)

**What:** Parse durations out of step text ("bake for 25 mins", "rest 10
minutes") into tap-to-start countdown buttons in Cooking Mode; notification/
sound on finish (PWA-friendly).

**Why fifth:** genuine kitchen delight, fully automatic from existing step
text — but situational (only while cooking) and cheap enough to slot in
anytime.

## 6. Ingredient search in the library  (S)

**What:** Library search also matches ingredient names ("salmon" finds every
recipe containing it), with a subtle "matched on: salmon" hint. Ingredients
are already parsed rows — nearly free.

**Why sixth:** useful when deciding what to cook around one ingredient, but
occasional rather than daily.

## 7. Instagram import thumbnails  (S–M)

**What:** IG image URLs are signed + expiring, so reel imports currently get
no image. Fix: the desktop fetcher downloads the thumbnail bytes once (yt-dlp
already returns the URL) and uploads to a Supabase Storage bucket → permanent
public URL on the recipe.

**Why last:** purely cosmetic — prettier library cards for reel imports. No
workflow value, hence the bottom despite being easy.

---

## Deliberately not planned

- **Pantry / "what can I make with what's home"** — requires manual inventory
  upkeep after every shop and meal; optional-entry features become dead weight
  in this household.
- **Manual aisle-ordering of the grocery list** — same reason.
- **Whisper transcription for video-only reels** — stays parked until
  video-only reels prove common in real use (1 of Harrison's 5 spike links).
- **Second nutrition database (USDA etc.)** — only if OFF + the growing
  per-user barcode cache demonstrably falls short.
