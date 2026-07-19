# Handoff: RecipeVault Mobile Redesign — "Glass" theme

## Overview
A full mobile redesign of RecipeVault, a private two-person household PWA (Harrison + Kiara) built with React + Vite, hosted on Vercel, backed by Supabase. The redesign repositions the app around the **daily macro tracker as the hero**; recipes, meal planning and groceries are secondary features. This package documents the approved "glass islands" design: frosted-glass cards floating over a soft pastel wash, pill-shaped controls, a floating dock, and a blue accent.

Target viewport: **~390×844, notched phone, installable PWA. Mobile only** — desktop is out of scope.

## About the Design Files
The files in this bundle are **design references created in HTML** — an interactive prototype showing intended look and behavior, not production code to copy directly. The task is to **recreate this design in the existing RecipeVault React + Vite codebase**, using its established patterns (Supabase data layer, existing routing, PWA setup). The prototype's inline styles are the spec; translate them into the codebase's styling approach (CSS modules, Tailwind, styled-components — whatever is already in use).

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, shadows and copy are final. Recreate the UI pixel-perfectly. The prototype's data (foods, recipes, logs) is sample data; wire the real Supabase data in its place.

## Design Tokens

Colors
- Ink (primary text): `#1b2430`
- Ground: `#eef3f0`, with a fixed pastel wash behind all content:
  `radial-gradient(600px 420px at 12% -4%, #cfe9d8 0%, transparent 62%), radial-gradient(560px 460px at 100% 22%, #cfe0f7 0%, transparent 60%), radial-gradient(520px 420px at 40% 108%, #e8ddf3 0%, transparent 58%)`
- Accent blue: `#2b64e0`; pressed/dark `#2456c4`; gradient fill for primary buttons/FAB: `linear-gradient(160deg, #3a7bfd, #2b64e0)`
- Accent tint (chips, banners): bg `rgba(43,100,224,.12)` / `rgba(43,100,224,.1)`, text `#2456c4`
- Muted text: `#5a6675` (secondary), `#8a95a3` (tertiary), `#9aa5b1` (placeholder/disabled), `#7b8794` (inactive dock)
- Macro colors: Protein `#34c759`, Carbs `#5e9bfd`, Fat `#a78bdf`
- Over-goal (gentle, never red-alarm): bar `#f0a35e`, text `#b45309`; trend over-bars `#f3c48f`
- Streak flame: `#c2410c`
- Destructive text links: `#c2410c`
- Dark surfaces (scanner, toast): `#101418` (toast at `rgba(16,20,24,.85)` + blur)

Glass recipe (the core surface treatment)
- Island card: `background: rgba(255,255,255,.6); backdrop-filter: blur(24px); border: 1px solid rgba(255,255,255,.75); border-radius: 24px; box-shadow: 0 12px 32px rgba(27,36,48,.08)`
- Hero island: same but radius 28, shadow `0 16px 40px rgba(27,36,48,.1)`
- Header pills/chips: `rgba(255,255,255,.55)`, blur 20, border `rgba(255,255,255,.7)`, radius 999, shadow `0 8px 24px rgba(27,36,48,.08)`
- Bottom sheets: `rgba(255,255,255,.85–.88)`, blur 30, radius `28px 28px 0 0`, top border `rgba(255,255,255,.9)`
- Nested tiles inside islands: `rgba(255,255,255,.65)`, border `rgba(255,255,255,.8)`, radius 18
- Always pair `backdrop-filter` with `-webkit-backdrop-filter`

Typography
- Font stack: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif` (bundle Inter as fallback for Android)
- Hero kcal number: 52px / 800 / letter-spacing -0.04em / line-height 1
- Screen titles: 26px / 800 / -0.02em; sheet titles 20px / 800
- Card headers: 14px / 800; entry names 14px / 600; entry meta 11.5px `#8a95a3`
- Section eyebrows (RECENTS, MEAL, AMOUNT): 12px / 800 / `#5a6675`, uppercase
- Dock labels: 9.5px / 700; body 13–14px; never below 11px

Shape & spacing
- Controls (buttons, inputs, segmented, chips, dock): fully pill (`border-radius: 999px`)
- Cards/islands: 24px (nested tiles 18–22px); inputs in forms: 14px
- Page gutter 16px; card padding 12–20px; card gap 10–12px
- Touch targets ≥ 44px (icon buttons in tight pills may be 30–40px visual but keep ≥44px hit area in implementation)
- Bottom safe area: dock floats at `bottom: 24px` with 16px side insets; scrollable content needs ~120px bottom padding to clear it; add `env(safe-area-inset-bottom)`

Buttons
- Primary: gradient blue pill, white 700 text, `box-shadow: 0 10px 24px rgba(43,100,224,.35)`, min-height 46–50px
- Secondary: `rgba(255,255,255,.7–.75)` pill with `1px solid rgba(27,36,48,.12)` border
- Ghost/text: borderless, blue 700 text
- Segmented controls: track `rgba(27,36,48,.06)` pill with 3px padding; selected segment = solid `#2b64e0` pill with white text
- FAB: 58px circle, gradient blue, `box-shadow: 0 14px 30px rgba(43,100,224,.4), inset 0 1px 0 rgba(255,255,255,.45)`

Inputs
- `rgba(255,255,255,.7–.9)` fill, `1px solid rgba(27,36,48,.1)` (or `rgba(255,255,255,.8)` on wash), radius 999 (search/single-line) or 14px (form fields), min-height 44–46px, focus outline `#2b64e0`

Dividers inside cards: `1px solid rgba(27,36,48,.07)`

## Navigation (decided)
- **Floating pill dock** (glass, 4 equal slots): Tracker · Trends · Recipes · More. Active = `#2b64e0` icon+label; inactive `#7b8794`.
- **Separate circular FAB** to the right of the dock opens Add Food from anywhere. Hidden when viewing the partner's read-only log.
- **More** opens a bottom sheet (not a screen): Meal plan, Groceries, Import recipe, Settings — each row: 40px round tinted glyph, label + sub-label, chevron.
- Lucide icons throughout (gauge = Tracker, trending line = Trends, book = Recipes, ellipsis = More, plus = FAB).

## Screens / Views

### 1. Tracker (HOME)
- **Header row**: left — glass date pill: round prev-day button, "Today, 18 Jul", round next-day button (35% opacity when disabled at today). Right — streak chip (flame icon + day count, `#c2410c` text) and H/K switcher (glass pill; active initial = 28px dark `#1b2430` circle with white text).
- **Partner banner** (only when viewing K): tinted blue banner "Kiara's log — read-only", radius 14.
- **Hero island** (radius 28): eyebrow "Eaten · estimates"; 52px kcal total + "/ 2,400 kcal" muted; 10px pill progress bar (blue gradient fill) — hidden when no goal; sub-line in blue 600: "558 left" / "N over — tomorrow is a new day" / "No goal set — showing energy share per macro". Below, 3 macro tiles (Protein/Carbs/Fat): label, "142 / 180 g" 800-weight value, 5px pill bar in the macro color. **Over-goal**: value text `#b45309`, bar `#f0a35e`, capped at 100%. **No goals set** (nullable): tiles show "142 g · 31%" (share of calories) and bars show the share.
- **Empty-day state**: island with "Nothing logged yet", streak-nudge copy, primary "+ Log a food" button.
- **Meal cards** (Breakfast/Lunch/Dinner/Snack, always all four): header "Breakfast · 469 kcal" + 32px round tinted "+" quick-add (hidden in partner view); entries as rows — name, meta line "Brand · portion · P x · C x · F x", right-aligned kcal. Empty meal shows "Nothing yet" muted.
- **In-place entry editing**: tapping a row expands a control strip: round − / + steppers (steps: 10 g in gram mode; 0.5 servings; 1 for unit foods), portion label, "Delete" (`#c2410c`) and "Done" pill. Only on own log, today.

### 2. Add Food flow (FAB or meal quick-add)
Bottom sheet, 88% height, glass. Title "Add food" + round close.
- **Segmented tabs**: Search / Scan / Manual.
- **Search tab**: pill search input ("Search foods (AU database)"). Before typing: **RECENTS** — most recent distinct foods from own log, one tap to pick. While typing: **RESULTS**. Rows: name (700), "Brand · serve" meta, kcal right. No match → "No match. Try the barcode scanner or enter it manually." (link switches to Manual). Footer caption: "Open food database (AU-first) · staples bundled for offline · values are estimates".
- **Scan tab**: full-bleed dark viewfinder (`#101418`, radial highlight), white rounded frame guide, animated blue scan line (2.6s ease-in-out loop, glow `#5e9bfd`), glass torch toggle top-right (white fill when on). Known barcode → resolves instantly to confirm step with toast "Barcode matched: …". Unknown → jumps to Manual with banner "Barcode not in the database yet — save it once and it's cached for next time."
- **Manual tab**: fields Name, Brand (optional), Serving size (g), kcal/serve, Protein, Carbs, Fat → "Continue" (primary) → confirm step. Saved food is cached into the local food list.
- **Confirm step**: "← Back to search" text link; food name + "Brand · 1 serve = X"; MEAL segmented (Breakfast/Lunch/Dinner/Snack — pre-selected from quick-add or time of day: <10h breakfast, <15h lunch, <20h dinner, else snack); AMOUNT − / + steppers (0.5 serving or 10 g) with SERVES/GRAMS segmented (switching to grams sets amount to one serve's grams); live computed macro tiles (KCAL/P/C/F); caption "Best-guess from the database — close enough is the point."; primary "Add to {meal}" → logs entry, returns to Tracker, toast "Added to {meal}".

### 3. Trends
Title + "Last 7 days · {person} · estimates". Verdict island: "On track" (≥5 of 7 days ≤ goal×1.05) / "Roughly on track" / "Steady week" (no goal), sub-line with the count; 7 bars (rounded 8px tops, 140px area): today `#2b64e0`, over-goal days `#f3c48f`, others `#c3cbd1`; dashed blue goal line at goal height (hidden when no goal); kcal value ("2.3k") above each bar, weekday labels below (today highlighted). Three stat tiles: Avg kcal, Avg protein, Days logged. Footer: "Daily totals are best-guess estimates from an open food database — read them as a weekly shape, not a lab report."

### 4. Recipes
Title, pill search, 2-column grid of glass cards: 92px tone-gradient header (`linear-gradient(160deg, {tone}, #eef3f0 240%)`) with big white initial (replace with photos when available), title, "25 min · ~620 kcal" meta, "K" chip when added by partner.

**Recipe detail** (full-screen over wash): 200px tone header with big initial + glass back button; title; chips (mins, "~620 kcal / serve · est.", "Added by Kiara"); macro line "P 42 g  C 48 g  F 26 g  per serve"; **Ingredients island** with − / + serving scaler ("2 serves", quantities scale proportionally, 1-decimal rounding); **Method island** with numbered steps (01, 02… blue numerals); primary "Start cooking mode".

**Cooking mode** (full-screen): blue gradient field `linear-gradient(170deg, #2b64e0, #173a8f)`, white text; recipe name + glass close top; giant step number (84px, 40% opacity) + step text (26px/800); footer "Step n of N", glass "Back" (40% opacity on step 1), white pill "Next"/"Done".

### 5. Meal plan (in More)
Sub-page with glass back button + title. "Mon 20 – Sun 26 Jul · shared" + secondary pill "Send week to groceries" (merges all planned-recipe ingredients into groceries, deduped case-insensitively; toast "N ingredients sent to groceries"). One glass card per day (Mon–Sun stacked): rows B / L / D — filled slot shows recipe title (700) + "recipe" chip, or free text; empty slot shows "Add dinner" placeholder muted. Tapping a slot opens a bottom sheet: free-text input + Save / "Clear slot", then "OR PICK A RECIPE" list (title + ~kcal). Real-time shared between partners (Supabase realtime).

### 6. Groceries (in More)
"Shared list · N to get"; pill input + primary "Add"; glass island list: 26px round check circle (blue fill + white check when done), label (strikethrough + muted when done), "Remove" text button.

### 7. Settings (in More)
Account island (name, email, "Signed in" chip; Theme row "Glass (light)"). **Daily goals island**: 2×2 inputs (Calories/Protein/Carbs/Fat) editing goals live; "Clear goals (track without targets)" text button → goals become null, tracker degrades to energy-share mode (toast explains). **Goal calculator island**: Age, Weight (kg), Activity select (Mostly sitting 1.2 / Lightly active 1.4 / Active 1.55 / Very active 1.75), Goal select (Lose slowly −450 / Maintain / Build +300); "Suggest goals" → tinted result box "2,600 kcal · P 148 · C 292 · F 74" with caption "rough guide, not medical advice" and primary "Use these". Formula: Mifflin-St Jeor (10w + 6.25·176 − 5·age + 5) × activity ± goal adj, rounded to 50; P = 1.8 g/kg, F = 0.9 g/kg, C = remainder /4.

### 8. Import recipe (in More)
URL input ("Paste a recipe URL or an Instagram reel link…") → "Fetch & review" → editable draft form (banner: "Scraped from link — check everything before saving. Macros are estimates."): Title, Cook time, kcal/serve, Ingredients (textarea, one per line), Steps (textarea) → "Save to recipes" → adds to library, navigates to Recipes, toast.

## Interactions & Behavior
- Toast: dark glass pill above the dock, auto-dismisses ~2.2s.
- Day stepping: back up to 6 days; forward disabled at today; editing only on today + own log.
- Partner view (K): read-only — FAB hidden, quick-adds hidden, entries not tappable; banner shown; K has **no goals** → tracker/trends use the no-goal degraded displays.
- Over-goal is informational, never alarming: amber tones, copy like "tomorrow is a new day".
- All estimated values labelled "est." / "estimates" at forgiving granularity.
- Sheets slide from bottom over a `rgba(16,20,24,.35)` scrim; tapping close (round ✕) dismisses.
- Focus states: blue outline; no browser-default rings.

## State Management (map to Supabase)
- `logs` per person per day: entries `{meal, foodId, amount, unit: 'serving'|'g'}`; macros computed as `food.per_serve × factor` (factor = amount, or grams/serve_g).
- `goals` per person, **nullable** (all displays must degrade).
- Cached/manual foods table (also barcode cache); recents = distinct foodIds from own recent entries, newest first.
- `recipes` (shared, `added_by`), `meal_plan` (day × slot → recipe ref | free text, shared realtime), `groceries` (shared checklist).
- Streak = consecutive days with ≥1 logged entry.

## Assets
- Icons: Lucide (lucide.dev) — gauge, trending-up, book, more-horizontal, plus, flame, chevrons, x, zap (torch), check.
- No photography in the prototype; recipe cards use tone-gradient placeholders (`#67c9a8 #f0a35e #e58fb1 #5e9bfd #8f7bd8 #4fc3d9`) — swap for real recipe photos.
- Fonts: system stack; optionally bundle Inter (400/600/700/800) for non-Apple devices.

## Files
- `RecipeVault App Glass.dc.html` — **the approved interactive prototype** (open in a browser; all flows work with sample data).
- `RecipeVault Explorations.dc.html` — design exploration history (option 2a is the source of this theme).
- `RecipeVault App.dc.html` — earlier green "ledger" direction, superseded; for reference only.
