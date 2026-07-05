# RecipeVault "Studio" Redesign — Design Spec

**Date:** 2026-07-05
**Status:** Approved by Harrison (visual directions chosen interactively via brainstorm mockups)

## Goal

Complete UI overhaul of RecipeVault — both the desktop Electron app and the mobile PWA — to a modern, clean-edged look. Visual system + targeted layout upgrades only: **zero feature or behavior changes**, same components, same data layer.

## Chosen direction (from mockup rounds)

| Decision | Choice |
|---|---|
| Visual direction | **Studio** — soft-modern light: cool gray canvas, white floating panels, crisp 8px corners, precise shadows |
| Theme mode | **Follow system** (`prefers-color-scheme`) with manual Light/Dark/System override in Settings |
| Accent | **Ember** `#e87f22` (refined version of the existing orange) |
| Typography | **Inter, self-hosted** (offline-safe in Electron; ~100KB PWA cost) |
| Scope | Skin + layout upgrades (Meal Plan, Tracker, Recipe Detail get new layouts; everything else reskinned in place) |
| Meal Plan | **Week Board** — 7 columns desktop; stacked day-list cards on mobile |
| Tracker | **Ring Dashboard** — hero calorie ring + macro bars, meal sections in 2-col grid |
| Recipe Detail | **Card Hero** — rounded photo card beside title/meta/actions |
| Mobile nav | **Floating Pill** — dark rounded dock, icons only, Ember active circle, 5 slots (Import + Settings under "More") |

Reference mockups live in `.superpowers/brainstorm/2056-1783241860/content/` (gitignored; the table above is authoritative).

## 1. Design system

### Tokens (CSS custom properties in `styles.css`)

**Studio Light (default):**

- Canvas `--bg-base: #f2f4f7`; panel `--bg-surface: #ffffff`; raised/hover `--bg-elevated: #f8f9fb`
- Text: primary `#101828`, secondary `#667085`, muted `#98a2b3`
- Accent: `--accent: #e87f22`, hover `--accent-bright: #f6902f`, tint bg `--accent-tint: #fdeedd`, tint text `--accent-deep: #c2620e`
- Border hairline `#e8eaee`; shadows: `--shadow-sm: 0 1px 3px rgba(16,24,40,.1)`, `--shadow-md: 0 4px 12px rgba(16,24,40,.12)`
- Functional: green `#10b981`, red `#e5483f`, amber `#f59e0b`, blue `#3b82f6` (protein=blue, carbs=green, fat=amber)

**Studio Dark (`[data-theme="dark"]`):**

- Canvas `#101216`; panel `#191c21`; elevated `#20242b`
- Text: primary `#ecedef`, secondary `#9ba0aa`, muted `#6b707a`
- Accent unchanged `#e87f22`; tint bg `rgba(232,127,34,.16)`, tint text `#f6a35a`
- Panels use hairline borders `rgba(255,255,255,.07)` **instead of shadows** (shadows don't read on dark); shadow tokens resolve to `none`/near-none
- Same functional colors (they hold up on dark)

**Theme switching:** `data-theme` attribute on `<html>`. On boot: read `localStorage` override (`light`/`dark`/`system`, default `system`); when `system`, resolve via `matchMedia('(prefers-color-scheme: dark)')` and live-update on change. Settings page gets a three-way Theme control. Also update the PWA `theme-color` meta dynamically.

### Type

- Inter via `@font-face`, weights 400/500/600/800, WOFF2 files in `src/renderer/assets/fonts/` (bundled by Vite for both targets). Fallback stack `system-ui, sans-serif`.
- Scale: page title 24px/800/−0.5px letter-spacing; section 18px/700; card title 14px/600; body 13px; meta/labels 11px; overline labels 10px uppercase +0.7px tracking, muted.

### Surfaces & spacing

- Radius: 8px cards/panels, 7px buttons/inputs, 99px pills/chips.
- Spacing on a 4px scale (4/8/12/16/20/24/32).
- Cards: `--bg-surface` + `--shadow-sm`; hover lift = `--shadow-md` + 1px translateY on interactive cards.
- Buttons: primary = Ember bg, white text, 600 weight; secondary = surface bg + shadow-sm; danger = red text. Inputs: surface bg, hairline border, Ember focus ring (2px `--accent-tint` + accent border).
- Icons remain the existing emoji, but consistently sized/aligned.

## 2. Desktop shell

- Sidebar: floating white panel (12px inset from canvas edges, radius 8, shadow-sm) — Studio's signature. Logo row: 16px Ember rounded square + "RecipeVault" 600 weight.
- Nav items: 13px, pill radius; active = `--accent-tint` bg + `--accent-deep` text; hover = `--bg-elevated`. All six destinations (Library, Meal Plan, Groceries, Tracker, Import, Settings).
- Main area padding 24px on the canvas color.

## 3. Page layouts

### Library (reskin)

- Header: 24px title, search input, Ember `+ Add recipe` button (routes to Import, as today).
- Recipe grid unchanged structurally; cards become white floating cards (image top, 14px title, muted "time · kcal" meta), hover lift.

### Meal Plan — Week Board (new layout, desktop ≥720px)

- Header: "This week" + Me/partner segmented pill (Ember active segment) + `🛒 Send to groceries` (primary) + `Clear week` (secondary). Read-only note when viewing partner.
- 7-column grid Mon–Sun, uppercase overline day labels. Today's label in Ember; today's card gets a 2px Ember ring.
- Cell states: recipe → photo card (image + title, click opens recipe); free text → text card with 🍜-style neutral thumb block; empty → dashed-border "+" slot.
- Editing (non-read-only): clicking "+"/edit opens the existing type-to-search editor rendered within the column (same `setMeal` behavior: pick recipe, or Enter for free text; Escape cancels). Clear (✕) on hover.
- **Mobile (<720px): the board becomes the stacked day-list** — one horizontal card per day (day label, 42px thumb, title, meta, TODAY badge for today, dashed "+ Plan a meal…" rows for empty days).

### Tracker — Ring Dashboard (new layout)

- Header: "Tracker" + person switcher + goals button as today; date nav becomes a compact segmented `‹ Today, Jul 5 ›` control.
- Hero card: conic-gradient Ember progress ring (~110px desktop) with centered "1,480 / of 2,400 kcal"; beside it the three macro bars (label, value/goal, slim 6px rounded track). Over-goal: ring/bar caps at 100% and value turns red.
- Meal log: Breakfast/Lunch/Dinner/Snacks as white cards in a 2-column grid (single column <720px). Card head = overline meal name + right-aligned kcal subtotal. Entries keep current name/brand/amount-edit/macros/delete behavior; `+ Add food` becomes an Ember-tinted text button opening the existing AddFoodModal.
- Mobile: hero card compresses (58px ring, bars beside it) — matches the approved phone mockup.

### Recipe Detail — Card Hero (new layout)

- `← All recipes` link; hero row: rounded photo card (~170×110 desktop, shadow) left of title (24px), description, chip row (owner/prep/cook/total/source — white pill chips), then actions (`🍳 Cook` primary, `🛒 Send to groceries` secondary, Delete danger, owner-only as today).
- No image → hero row simply has no photo card (no fallback art).
- Below: ingredients card (servings stepper in the card head) and steps card (Ember step numbers, section labels as overlines) in the existing 1:1.6 two-column grid; single column on mobile with photo card full-width above the title.

### Groceries, Import, Settings, Sign-in/Set-password (reskin only)

- Inherit the system: white cards, new inputs/buttons/typography. Grocery list items keep check/strikethrough behavior.
- Settings gains the Theme (Light/Dark/System) control.
- Auth pages: single centered white card (max-width ~380px) on the canvas, Ember primary button.

### Cooking mode & modals (reskin only)

- Modals (AddFoodModal, GroceryPreviewModal, ProfileModal, RecipeReviewForm, BarcodeScanner): dark scrim `rgba(16,18,22,.6)`, white 8px-radius panel, shadow-md, same fields/behavior. Dark theme: panel = `--bg-surface` dark + hairline border.
- CookingMode: full-screen surface in theme colors, large-type steps, Ember progress/next affordances. Behavior untouched.

## 4. Mobile PWA specifics

- **Floating pill dock** replaces the current full-width bottom bar (<720px): fixed, 12px side insets, `bottom: 12px + env(safe-area-inset-bottom)`, dark `rgba(20,22,27,.94)` pill (both themes — it's a dark element by design), radius 99, shadow, icons only. Active tab = Ember circle behind the icon.
- 5 slots: 📖 Library, 🗓️ Plan, 🛒 Groceries, 📊 Tracker, ⋯ More. **More** opens a small sheet/menu with Import and Settings (new tiny component; navigation behavior otherwise unchanged).
- Keep existing mobile rules: ≥44px tap targets, 16px input font (iOS zoom), safe-area insets; main-area bottom padding accounts for the floating pill height + inset.
- Update PWA manifest `theme_color`/`background_color` to Studio values.

## 5. Implementation shape

- **No new runtime dependencies.** Inter font files are the only new assets.
- `styles.css` rewritten around the token system (single file stays — it's ~1.1k lines and one file is fine at this size; split only if it grows unwieldy).
- Markup restructured in: `MealPlanPage.tsx`, `MacroTrackerPage.tsx`, `RecipeDetailPage.tsx`, `Sidebar.tsx` (pill dock + More sheet on mobile), `SettingsPage.tsx` (theme control). Light class-name touch elsewhere.
- New tiny modules: theme manager (boot + toggle + matchMedia listener) and the mobile More sheet.
- Data layer, hooks, shared logic, Supabase: **untouched**.

## 6. Error handling / edge cases

- Recipes without images: Library card shows a neutral placeholder block (existing behavior restyled); Detail omits the photo card; Week Board cell renders as text-style card.
- Over-goal macros: red value text, capped bars/ring.
- Long recipe titles: 2-line clamp on cards, ellipsis in Week Board cells.
- Partner read-only states preserved everywhere (no edit affordances, note shown).
- `prefers-color-scheme` unsupported (old WebView): resolves to light.

## 7. Testing & verification

- Existing vitest suites must stay green (behavior unchanged; tests that assert on class names/markup of the three restructured pages get updated alongside).
- Visual verification: Electron app (light + dark), browser at iPhone size (~390px) for all five tabs + More sheet, both themes; confirm no iOS zoom-on-focus, pill dock clears safe area, Week Board ↔ day-list switch at 720px.
- PWA: `npm run build:web` clean; manifest colors updated.

## Out of scope

- Any feature/behavior changes, new pages, or nav restructuring beyond the mobile More grouping
- Custom icon set (emoji stay), branded app icon changes
- Dark-mode-specific imagery or fallback art for imageless recipes
