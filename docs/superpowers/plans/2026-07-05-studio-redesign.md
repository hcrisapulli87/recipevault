# RecipeVault "Studio" Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the entire RecipeVault UI (Electron desktop + mobile PWA) to the approved "Studio" design — light/dark system-following themes, Ember accent, Inter type — with layout upgrades to Meal Plan (Week Board), Tracker (Ring Dashboard), Recipe Detail (Card Hero), and mobile nav (Floating Pill dock). Zero behavior/data changes.

**Architecture:** The existing CSS custom-property names (`--bg-base`, `--accent`, etc.) are kept and re-valued for Studio Light, with a `[data-theme="dark"]` override set — so untouched CSS sections reskin automatically, and per-page tasks then upgrade layout details. A tiny theme manager applies `data-theme` to `<html>`. Three pages get restructured markup; a new `MobileDock` component replaces the mobile-sidebar media query. Spec: `docs/superpowers/specs/2026-07-05-studio-redesign-design.md`.

**Tech Stack:** React 19 + TypeScript, vanilla CSS (single `src/renderer/styles.css`), Vitest + jsdom, electron-vite + vite/vite-plugin-pwa. No new npm dependencies; one new font asset (Inter variable WOFF2).

**Verification model:** Existing tests are all logic tests (shared modules/data) and must stay green. The theme manager is new behavior → TDD. Markup/CSS tasks are verified by `npm run typecheck:web` + `npm run test:run` per task, with full visual verification (both themes, desktop + 390px) as the final task.

**Branch:** all work on `feat/studio-redesign` (created in Task 1).

---

### Task 1: Branch, Inter font, and the Studio token system

**Files:**
- Create: `src/renderer/assets/fonts/InterVariable.woff2` (downloaded)
- Modify: `src/renderer/styles.css:1-28` (reset + `:root` + `body`)

- [ ] **Step 1: Create the branch**

```bash
cd "C:/Users/Harrison Crisapulli/Documents/claudecode/recipe-vault"
git checkout -b feat/studio-redesign
```

- [ ] **Step 2: Download the Inter variable font**

(Use curl — Node `fetch` fails in sandboxed Bash on this machine.)

```bash
mkdir -p src/renderer/assets/fonts
curl -L -o src/renderer/assets/fonts/InterVariable.woff2 https://rsms.me/inter/font-files/InterVariable.woff2
ls -la src/renderer/assets/fonts/   # expect ~300-400KB file, non-zero
```

- [ ] **Step 3: Replace the top of `styles.css` (lines 1–28: reset, `:root`, `body`) with the token system**

Keep every existing custom-property NAME working; add the new ones. Replace with:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

@font-face {
  font-family: 'Inter';
  src: url('./assets/fonts/InterVariable.woff2') format('woff2');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}

/* ── Studio Light (default) ─────────────────────────────────────────────── */
:root {
  --bg-base: #f2f4f7;
  --bg-surface: #ffffff;
  --bg-elevated: #eef0f4;
  --border: #e8eaee;
  --accent: #e87f22;
  --accent-bright: #f6902f; /* hover on accent surfaces */
  --accent-deep: #c2620e; /* accent-colored TEXT (contrast-safe per theme) */
  --accent-tint: #fdeedd; /* accent-tinted backgrounds (nav pill, badges) */
  --on-accent: #ffffff; /* text on solid accent */
  --text-primary: #101828;
  --text-secondary: #667085;
  --text-muted: #98a2b3;
  --green: #10b981;
  --red: #e5483f;
  --amber: #f59e0b;
  --blue: #3b82f6;
  --shadow-sm: 0 1px 3px rgba(16, 24, 40, 0.1);
  --shadow-md: 0 4px 12px rgba(16, 24, 40, 0.14);
  --scrim: rgba(16, 18, 22, 0.6);
  --radius: 8px;
  --radius-btn: 7px;
}

/* ── Studio Dark ────────────────────────────────────────────────────────── */
/* Panels rely on hairline borders, not shadows (shadows don't read on dark). */
[data-theme='dark'] {
  --bg-base: #101216;
  --bg-surface: #191c21;
  --bg-elevated: #20242b;
  --border: rgba(255, 255, 255, 0.07);
  --accent-deep: #f6a35a;
  --accent-tint: rgba(232, 127, 34, 0.16);
  --text-primary: #ecedef;
  --text-secondary: #9ba0aa;
  --text-muted: #6b707a;
  --shadow-sm: none;
  --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.5);
  --scrim: rgba(0, 0, 0, 0.65);
}

body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 4: Fix hardcoded old-theme colors that the token swap exposes**

In `styles.css`, replace these literal values:
- `.btn--primary` block: `color: #1a1408` → `color: var(--on-accent)`
- `.food-result__tag` block: `color: #1a1408` → `color: var(--on-accent)`
- `.link-btn`: `color: var(--accent-bright)` → `color: var(--accent-deep)` (accent text now uses the contrast-safe token; same swap in `.review-form__section`, `.step-list__section`, `.cooking__progress`, `.totals-card__cals-value`, `.food-entry__cals`)
- `.sidebar__title`: `color: var(--accent-bright)` → `color: var(--text-primary)` (restyled properly in Task 4)

- [ ] **Step 5: Verify build + tests**

```bash
npm run typecheck:web   # expect: clean
npm run test:run        # expect: all existing suites pass
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/assets/fonts/InterVariable.woff2 src/renderer/styles.css
git commit -m "feat(ui): Studio token system (light+dark) + bundled Inter"
```

---

### Task 2: Theme manager (TDD) + boot wiring

**Files:**
- Create: `src/renderer/lib/theme.ts`
- Test: `tests/theme.test.ts`
- Modify: `src/renderer/main.tsx` (call `initTheme()` before render)
- Modify: `src/renderer/index.html` (meta theme-color → `#f2f4f7`)

- [ ] **Step 1: Write the failing test**

Create `tests/theme.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getThemePref, setThemePref, initTheme } from '../src/renderer/lib/theme'

function mockMatchMedia(prefersDark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: prefersDark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  )
}

describe('theme manager', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.head.innerHTML = '<meta name="theme-color" content="#f2f4f7" />'
  })

  it('defaults to system preference', () => {
    mockMatchMedia(true)
    initTheme()
    expect(getThemePref()).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('resolves system-light to light', () => {
    mockMatchMedia(false)
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('setThemePref overrides system and persists', () => {
    mockMatchMedia(false)
    initTheme()
    setThemePref('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('rv-theme')).toBe('dark')
  })

  it('updates the theme-color meta to match the resolved theme', () => {
    mockMatchMedia(false)
    initTheme()
    setThemePref('dark')
    const meta = document.querySelector('meta[name="theme-color"]')
    expect(meta?.getAttribute('content')).toBe('#101216')
  })

  it('re-applies system preference when set back to system', () => {
    mockMatchMedia(false)
    initTheme()
    setThemePref('dark')
    setThemePref('system')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('rv-theme')).toBe('system')
  })
})
```

- [ ] **Step 2: Run it — expect failure (module doesn't exist)**

```bash
npx vitest run tests/theme.test.ts
# Expected: FAIL — Cannot find module '../src/renderer/lib/theme'
```

- [ ] **Step 3: Implement `src/renderer/lib/theme.ts`**

```ts
export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'rv-theme'
const META_COLOR = { light: '#f2f4f7', dark: '#101216' } as const

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  // Old WebViews without matchMedia fall back to light.
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function apply(): void {
  const theme = resolve(getThemePref())
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[theme])
}

export function setThemePref(pref: ThemePref): void {
  localStorage.setItem(KEY, pref)
  apply()
}

export function initTheme(): void {
  apply()
  if (typeof matchMedia === 'function') {
    // Live-update while in system mode (apply() re-checks the pref itself).
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run tests/theme.test.ts   # Expected: 5 passed
```

- [ ] **Step 5: Wire into boot + index.html**

In `src/renderer/main.tsx`, add `import { initTheme } from './lib/theme'` and call `initTheme()` as the first statement before rendering. In `src/renderer/index.html`, change `<meta name="theme-color" content="#16181d" />` to `content="#f2f4f7"`.

- [ ] **Step 6: Full verify + commit**

```bash
npm run typecheck:web && npm run test:run   # expect: clean / all pass
git add src/renderer/lib/theme.ts tests/theme.test.ts src/renderer/main.tsx src/renderer/index.html
git commit -m "feat(ui): system-following theme manager with manual override"
```

---

### Task 3: Shared controls reskin (buttons, inputs, chips, tabs, modals, banners)

**Files:**
- Modify: `src/renderer/styles.css` (sections: "Shared bits", `.chip`, `.banner`, `.modal*`, `.tabs*`)

- [ ] **Step 1: Replace the "Shared bits" section** (`.page-header` through `.icon-btn`, currently lines ~92–162) with:

```css
/* Shared bits */
.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.page-header__title {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.5px;
  margin-right: auto;
}
.text-input {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 8px 12px;
  border-radius: var(--radius-btn);
  font-size: 13px;
  font-family: inherit;
  box-shadow: var(--shadow-sm);
}
.text-input::placeholder {
  color: var(--text-muted);
}
.text-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-tint);
}
.btn {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 8px 14px;
  border-radius: var(--radius-btn);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: box-shadow 0.15s, border-color 0.15s;
}
.btn:hover:not(:disabled) {
  border-color: var(--text-muted);
  box-shadow: var(--shadow-md);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn--primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.btn--primary:hover:not(:disabled) {
  background: var(--accent-bright);
  border-color: var(--accent-bright);
}
.btn--danger {
  color: var(--red);
}
.icon-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  border-radius: var(--radius-btn);
  padding: 4px 9px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.icon-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--accent);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.link-btn {
  background: none;
  border: none;
  color: var(--accent-deep);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: none;
}
.link-btn:hover {
  text-decoration: underline;
}
```

- [ ] **Step 2: Restyle `.chip`, `.banner`, `.modal`, `.tabs`**

Replace those blocks (keep every selector name):

```css
.chip {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 99px;
  padding: 4px 11px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  box-shadow: var(--shadow-sm);
}
```

`.banner` paddings/layout stay; change `border-radius: 6px` → `var(--radius-btn)`.

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  z-index: 150;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: 24px;
  width: 440px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.modal__title {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
}
```

`.tabs` becomes the segmented Me/partner pill (PersonSwitcher and AddFoodModal both use it — no TSX change needed):

```css
.tabs {
  display: inline-flex;
  gap: 2px;
  background: var(--bg-surface);
  border-radius: 99px;
  padding: 3px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border);
  margin-bottom: 0;
}
.tabs__tab {
  background: none;
  border: none;
  color: var(--text-secondary);
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  border-radius: 99px;
}
.tabs__tab--active {
  background: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
```

(AddFoodModal's tab strip inherits the pill look too — acceptable and consistent; add `margin-bottom: 14px` back via the existing `.modal .tabs` context if it crowds: `.modal .tabs { margin-bottom: 14px; }`.)

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck:web && npm run test:run
git add src/renderer/styles.css
git commit -m "feat(ui): Studio shared controls — buttons, inputs, chips, segmented pills, modals"
```

---

### Task 4: Desktop shell — floating sidebar panel

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx` (logo row)
- Modify: `src/renderer/styles.css` (`.app__main`, `/* Sidebar */` section)

- [ ] **Step 1: Update the Sidebar logo row in `Sidebar.tsx`**

Replace `<h1 className="sidebar__title">🍳 RecipeVault</h1>` with:

```tsx
<h1 className="sidebar__title">
  <span className="sidebar__logo-dot" aria-hidden="true" />
  RecipeVault
</h1>
```

- [ ] **Step 2: Replace the `/* Sidebar */` CSS section and `.app__main`**

```css
.app__main {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}

/* Sidebar — floating Studio panel */
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  margin: 12px 0 12px 12px;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.sidebar__title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;
  color: var(--text-primary);
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.sidebar__logo-dot {
  width: 16px;
  height: 16px;
  background: var(--accent);
  border-radius: 5px;
  flex-shrink: 0;
}
.sidebar__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sidebar__nav-btn {
  background: none;
  border: none;
  text-align: left;
  padding: 8px 12px;
  border-radius: 99px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
}
.sidebar__nav-btn:hover {
  color: var(--text-primary);
  background: var(--bg-elevated);
}
.sidebar__nav-btn--active {
  color: var(--accent-deep);
  background: var(--accent-tint);
  font-weight: 600;
}
.sidebar__nav-icon {
  margin-right: 8px;
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck:web && npm run test:run
git add src/renderer/components/Sidebar.tsx src/renderer/styles.css
git commit -m "feat(ui): floating Studio sidebar panel with Ember pill nav"
```

---

### Task 5: Library reskin

**Files:**
- Modify: `src/renderer/styles.css` (`/* Library */` section)

No TSX changes — LibraryPage markup already matches the approved mockup (header + search + primary button + grid).

- [ ] **Step 1: Replace the `/* Library */` section**

```css
/* Library */
.recipe-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 16px;
}
.recipe-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  transition: transform 0.15s, box-shadow 0.15s;
  padding: 0;
  color: inherit;
  font-family: inherit;
}
.recipe-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.recipe-card__image-wrapper {
  aspect-ratio: 4 / 3;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.recipe-card__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.recipe-card__placeholder {
  font-size: 40px;
  opacity: 0.4;
}
.recipe-card__info {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.recipe-card__title {
  font-size: 14px;
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.recipe-card__time {
  font-size: 11px;
  color: var(--text-muted);
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck:web && npm run test:run
git add src/renderer/styles.css
git commit -m "feat(ui): Studio library cards — floating, hover lift, title clamp"
```

---

### Task 6: Recipe Detail — Card Hero

**Files:**
- Modify: `src/renderer/styles.css` (`/* Recipe detail */` section)

No TSX changes — the existing `detail__hero` (image + head) markup already IS the Card Hero structure; this is a restyle. Imageless recipes already omit the `<img>`.

- [ ] **Step 1: Replace the `/* Recipe detail */` section styles**

Keep all selector names; new values:

```css
/* Recipe detail — Card Hero */
.detail {
  max-width: 960px;
}
.detail__hero {
  display: flex;
  gap: 20px;
  margin: 16px 0 24px;
}
.detail__image {
  width: 220px;
  height: 160px;
  object-fit: cover;
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  background: var(--bg-elevated);
  flex-shrink: 0;
}
.detail__title {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.5px;
}
.detail__columns {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 20px;
  align-items: start;
}
.detail__ingredients,
.detail__steps {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  padding: 16px;
}
.detail__section-head h3,
.detail__steps h3 {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--text-muted);
}
.ingredient-list li {
  padding: 8px 0;
  background: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  font-size: 13px;
}
.ingredient-list li:last-child {
  border-bottom: none;
}
.step-list {
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.7;
}
.step-list li::marker {
  color: var(--accent-deep);
  font-weight: 700;
}
```

(Blocks not listed — `.detail__head`, `.detail__description`, `.detail__chips`, `.detail__actions`, `.servings-stepper*`, `.step-list__section` — keep their existing rules; they inherit the new tokens.)

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck:web && npm run test:run
git add src/renderer/styles.css
git commit -m "feat(ui): Card Hero recipe detail — floating ingredient/step panels"
```

---

### Task 7: Meal Plan — Week Board

**Files:**
- Modify: `src/renderer/pages/MealPlanPage.tsx` (DayRow → DayCell; board grid)
- Modify: `src/renderer/styles.css` (replace `/* Meal plan */` section)

Behavior preserved exactly: same `setMeal`/`clearWeek` calls, type-to-search editor (Enter = free text, Escape = cancel, suggestion click = recipe), read-only partner view, grocery preview. New: photo cards via `RecipeSummary.imageUrl`, today highlight, dashed empty slots.

- [ ] **Step 1: Rewrite `DayRow` as `DayCell` in `MealPlanPage.tsx`**

Replace the `DAY_LABEL` constant and the whole `DayRow` component with:

```tsx
const DAY_LABEL: Record<Day, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun'
}

const DAY_ORDER: Day[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
]
const todayDay = (): Day => {
  // getDay(): 0=Sunday … 6=Saturday; our week starts Monday.
  const jsDay = new Date().getDay()
  return DAY_ORDER[(jsDay + 6) % 7]
}

function DayCell(props: {
  entry: MealPlanEntry
  recipes: RecipeSummary[]
  readOnly: boolean
  onSet: (recipeId: number | null, freeText: string | null) => void
  onOpenRecipe: (id: number) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const { entry, recipes } = props
  const isToday = entry.day === todayDay()

  const recipe = entry.recipeId !== null ? recipes.find((r) => r.id === entry.recipeId) : undefined
  const matches =
    query.trim() === ''
      ? recipes
      : recipes.filter((r) => r.title.toLowerCase().includes(query.toLowerCase()))

  const choose = (recipeId: number | null, freeText: string | null): void => {
    props.onSet(recipeId, freeText)
    setEditing(false)
    setQuery('')
  }

  return (
    <div className={`board-cell ${isToday ? 'board-cell--today' : ''}`}>
      <span className="board-cell__day">
        {DAY_LABEL[entry.day]}
        {isToday && <span className="board-cell__today-tag"> · today</span>}
      </span>

      {recipe ? (
        <div className="board-card board-card--recipe">
          <button
            className="board-card__open"
            onClick={() => props.onOpenRecipe(recipe.id)}
            title="Open recipe"
          >
            {recipe.imageUrl ? (
              <img className="board-card__image" src={recipe.imageUrl} alt="" />
            ) : (
              <div className="board-card__image board-card__image--empty">🍽️</div>
            )}
            <span className="board-card__title">{recipe.title}</span>
          </button>
          {!props.readOnly && <CellActions onEdit={() => setEditing(true)} onClear={() => choose(null, null)} />}
        </div>
      ) : entry.freeText ? (
        <div className="board-card board-card--text">
          <span className="board-card__title">{entry.freeText}</span>
          <span className="board-card__meta">free text</span>
          {!props.readOnly && <CellActions onEdit={() => setEditing(true)} onClear={() => choose(null, null)} />}
        </div>
      ) : props.readOnly ? (
        <div className="board-card board-card--blank">—</div>
      ) : (
        <button className="board-card board-card--empty" onClick={() => setEditing(true)}>
          +
        </button>
      )}

      {editing && (
        <div className="board-cell__editor">
          <input
            autoFocus
            className="text-input"
            placeholder="Search recipes or type a meal…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter' && query.trim()) choose(null, query.trim())
            }}
          />
          {matches.length > 0 && (
            <ul className="board-cell__suggestions">
              {matches.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <button className="board-cell__suggestion" onClick={() => choose(r.id, null)}>
                    📖 {r.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() && (
            <button className="link-btn" onClick={() => choose(null, query.trim())}>
              Use “{query.trim()}” as free text ↵
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CellActions(props: { onEdit: () => void; onClear: () => void }): JSX.Element {
  return (
    <div className="board-card__btns">
      <button className="icon-btn" title="Edit" onClick={props.onEdit}>
        ✏️
      </button>
      <button className="icon-btn" title="Clear" onClick={props.onClear}>
        ✕
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Update the page body** — in `MealPlanPage`'s return, replace the `plan-grid` div:

```tsx
<div className="board">
  {plan.map((entry) => (
    <DayCell
      key={entry.day}
      entry={entry}
      recipes={props.recipes}
      readOnly={readOnly}
      onSet={(recipeId, freeText) => setDay(entry.day, recipeId, freeText)}
      onOpenRecipe={props.onOpenRecipe}
    />
  ))}
</div>
```

- [ ] **Step 3: Replace the `/* Meal plan */` CSS section** (`.plan-grid` through `.plan-note code`; keep `.plan-note` rules) with:

```css
/* Meal plan — Week Board (7 columns desktop, stacked list on phones) */
.board {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 10px;
  align-items: start;
}
.board-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.board-cell__day {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--text-muted);
}
.board-cell--today .board-cell__day,
.board-cell__today-tag {
  color: var(--accent-deep);
}
.board-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  position: relative;
  min-height: 92px;
  display: flex;
  flex-direction: column;
}
.board-cell--today .board-card {
  box-shadow: 0 0 0 2px var(--accent), var(--shadow-sm);
}
.board-card__open {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
  font-family: inherit;
  text-align: left;
  display: flex;
  flex-direction: column;
  flex: 1;
}
.board-card__image {
  width: 100%;
  height: 64px;
  object-fit: cover;
  display: block;
}
.board-card__image--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  font-size: 22px;
  opacity: 0.5;
}
.board-card__title {
  font-size: 11px;
  font-weight: 600;
  padding: 6px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.board-card--text {
  padding: 8px;
  justify-content: center;
}
.board-card--text .board-card__title {
  padding: 0;
  color: var(--text-secondary);
}
.board-card__meta {
  font-size: 9px;
  color: var(--text-muted);
  padding: 2px 0 0;
}
.board-card--empty {
  border: 1.5px dashed var(--border);
  background: none;
  box-shadow: none;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}
.board-card--empty:hover {
  border-color: var(--accent);
  color: var(--accent-deep);
}
.board-card--blank {
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  box-shadow: none;
  background: none;
  border-style: dashed;
}
.board-card__btns {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  gap: 3px;
}
.board-card:hover .board-card__btns {
  display: flex;
}
.board-card__btns .icon-btn {
  background: var(--bg-surface);
  padding: 1px 6px;
  font-size: 11px;
}
/* Editor popover under the cell */
.board-cell__editor {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  width: 240px;
  margin-top: 4px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.board-cell:nth-child(n + 5) .board-cell__editor {
  left: auto;
  right: 0; /* keep the popover on-screen for Fri–Sun columns */
}
.board-cell__suggestions {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.board-cell__suggestion {
  background: var(--bg-elevated);
  border: none;
  color: var(--text-primary);
  text-align: left;
  padding: 6px 10px;
  border-radius: 5px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  width: 100%;
}
.board-cell__suggestion:hover {
  background: var(--accent-tint);
  color: var(--accent-deep);
}
```

- [ ] **Step 4: Verify + commit**

```bash
npm run typecheck:web && npm run test:run
git add src/renderer/pages/MealPlanPage.tsx src/renderer/styles.css
git commit -m "feat(ui): Week Board meal plan — photo cards, today ring, editor popover"
```

---

### Task 8: Tracker — Ring Dashboard

**Files:**
- Modify: `src/renderer/pages/MacroTrackerPage.tsx` (totals card → hero ring; meal sections → card grid; macro colors)
- Modify: `src/renderer/styles.css` (replace `.date-nav`/`.totals-card*` blocks; restyle `.meal-section*`, `.food-entry`)

Behavior preserved: same data flow, date nav rules, AddFoodModal/ProfileModal, entry edit/delete.

- [ ] **Step 1: Replace the totals card JSX** in `MacroTrackerPage` return (the `<div className="totals-card">…</div>` block) with:

```tsx
<div className="hero-card">
  <div
    className="cal-ring"
    style={{
      background: `conic-gradient(var(--accent) ${
        goals.calories ? Math.min(100, (totals.calories / goals.calories) * 100) : 0
      }%, var(--bg-elevated) 0)`
    }}
  >
    <div className="cal-ring__inner">
      <span
        className={`cal-ring__value ${
          goals.calories != null && totals.calories > goals.calories ? 'cal-ring__value--over' : ''
        }`}
      >
        {Math.round(totals.calories).toLocaleString()}
      </span>
      <span className="cal-ring__label">
        {goals.calories != null ? `of ${Math.round(goals.calories).toLocaleString()} kcal` : 'kcal'}
      </span>
    </div>
  </div>
  <div className="hero-card__bars">
    <MacroBar label="Protein" value={totals.protein} goal={goals.protein} unit="g" color="var(--blue)" />
    <MacroBar label="Carbs" value={totals.carbs} goal={goals.carbs} unit="g" color="var(--green)" />
    <MacroBar label="Fat" value={totals.fat} goal={goals.fat} unit="g" color="var(--amber)" />
  </div>
</div>
```

- [ ] **Step 2: Wrap the meal sections in a grid** — replace `{MEAL_TYPES.map((meal) => { … })}` output wrapper: keep the map exactly as-is but enclose it in `<div className="meal-grid"> … </div>`.

- [ ] **Step 3: CSS — replace `.date-nav` and `.totals-card*` blocks** with:

```css
/* Tracker — Ring Dashboard */
.date-nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 18px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-btn);
  box-shadow: var(--shadow-sm);
  padding: 3px;
}
.date-nav .icon-btn {
  border: none;
}
.date-nav__label {
  font-size: 13px;
  font-weight: 600;
  min-width: 110px;
  text-align: center;
}
.date-nav .link-btn {
  margin: 0 8px;
}
.hero-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  padding: 20px 24px;
  display: flex;
  gap: 28px;
  align-items: center;
  margin-bottom: 20px;
}
.cal-ring {
  width: 116px;
  height: 116px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cal-ring__inner {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.cal-ring__value {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.5px;
  line-height: 1.1;
}
.cal-ring__value--over {
  color: var(--red);
}
.cal-ring__label {
  font-size: 10px;
  color: var(--text-muted);
}
.hero-card__bars {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.meal-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: start;
}
```

- [ ] **Step 4: CSS — restyle `.meal-section` and `.food-entry` into cards** (replace those blocks; keep child selectors not mentioned):

```css
.meal-section {
  margin-bottom: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
  padding: 12px 14px;
}
.meal-section__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
  margin-bottom: 4px;
}
.meal-section__title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--text-muted);
}
.food-entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-radius: 0;
  border-bottom: 1px solid var(--bg-elevated);
  background: none;
}
.food-entry:last-child {
  border-bottom: none;
}
.food-entry:hover {
  background: none;
}
```

Also in `MacroBar` usage nothing else changes — `.macro-bar__track` keep, but change `height: 7px` → `height: 6px` and `border-radius: 4px` → `99px` (track and fill).

- [ ] **Step 5: Verify + commit**

```bash
npm run typecheck:web && npm run test:run
git add src/renderer/pages/MacroTrackerPage.tsx src/renderer/styles.css
git commit -m "feat(ui): Ring Dashboard tracker — calorie ring hero, meal card grid"
```

---

### Task 9: Remaining pages + Settings theme control + cooking mode

**Files:**
- Modify: `src/renderer/pages/SettingsPage.tsx` (add Theme section)
- Modify: `src/renderer/styles.css` (`.settings__section`, `.signin`, `.cooking*`, `.import-page`, `.grocery-page*`, `.food-result`)

- [ ] **Step 1: Add the Theme control to `SettingsPage.tsx`**

Add imports and state:

```tsx
import { getThemePref, setThemePref } from '../lib/theme'
import type { ThemePref } from '../lib/theme'
```

Inside the component: `const [theme, setTheme] = useState<ThemePref>(getThemePref())`, and add this section between Account and Sync:

```tsx
<section className="settings__section">
  <h3>Appearance</h3>
  <div className="tabs">
    {(['light', 'dark', 'system'] as const).map((p) => (
      <button
        key={p}
        className={`tabs__tab ${theme === p ? 'tabs__tab--active' : ''}`}
        onClick={() => {
          setThemePref(p)
          setTheme(p)
        }}
      >
        {p === 'light' ? '☀️ Light' : p === 'dark' ? '🌙 Dark' : '🖥️ System'}
      </button>
    ))}
  </div>
</section>
```

- [ ] **Step 2: CSS touch-ups for the remaining pages**

- `.settings__section`: swap `border-radius: 10px` → `var(--radius)`, add `box-shadow: var(--shadow-sm)`.
- `.signin`: change to a centered card — add `background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-md); padding: 28px; margin-top: 10vh; max-width: 380px;` and `.signin__title { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }`.
- `.cooking`: keep layout; change `.cooking__step` `border: 2px solid var(--border)` → `border: 1px solid var(--border); box-shadow: var(--shadow-md); border-radius: var(--radius);` and `.cooking__step--done` keeps green border.
- `.food-result`: `background: var(--bg-elevated)` → `background: var(--bg-surface); box-shadow: var(--shadow-sm);` (result rows float inside the modal).
- `.grocery-page__row`: add `background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-btn); box-shadow: var(--shadow-sm); padding: 10px 12px; margin-bottom: 6px;`.

- [ ] **Step 3: Verify + commit**

```bash
npm run typecheck:web && npm run test:run
git add src/renderer/pages/SettingsPage.tsx src/renderer/styles.css
git commit -m "feat(ui): Studio reskin for settings/auth/groceries/cooking + theme picker"
```

---

### Task 10: Mobile — Floating Pill dock + More sheet + responsive rules

**Files:**
- Create: `src/renderer/components/MobileDock.tsx`
- Modify: `src/renderer/App.tsx` (render dock)
- Modify: `src/renderer/styles.css` (replace the entire `@media (max-width: 720px)` block)

- [ ] **Step 1: Create `src/renderer/components/MobileDock.tsx`**

```tsx
import { useState } from 'react'
import type { JSX } from 'react'
import type { Page } from '../App'

const TABS: { page: Page; label: string; icon: string }[] = [
  { page: 'library', label: 'Recipes', icon: '📖' },
  { page: 'plan', label: 'Plan', icon: '🗓️' },
  { page: 'groceries', label: 'Groceries', icon: '🛒' },
  { page: 'tracker', label: 'Tracker', icon: '🥗' }
]
const MORE_PAGES: { page: Page; label: string; icon: string }[] = [
  { page: 'import', label: 'Import', icon: '🔗' },
  { page: 'settings', label: 'Settings', icon: '⚙️' }
]

export function MobileDock(props: { page: Page; onNavigate: (page: Page) => void }): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MORE_PAGES.some((t) => t.page === props.page)

  const go = (page: Page): void => {
    setMoreOpen(false)
    props.onNavigate(page)
  }

  return (
    <>
      {moreOpen && <div className="dock-sheet__backdrop" onClick={() => setMoreOpen(false)} />}
      {moreOpen && (
        <div className="dock-sheet">
          {MORE_PAGES.map((t) => (
            <button key={t.page} className="dock-sheet__item" onClick={() => go(t.page)}>
              <span aria-hidden="true">{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      )}
      <nav className="dock" aria-label="Primary">
        {TABS.map((t) => (
          <button
            key={t.page}
            className={`dock__tab ${props.page === t.page ? 'dock__tab--active' : ''}`}
            aria-label={t.label}
            title={t.label}
            onClick={() => go(t.page)}
          >
            {t.icon}
          </button>
        ))}
        <button
          className={`dock__tab ${moreActive ? 'dock__tab--active' : ''}`}
          aria-label="More"
          title="More"
          onClick={() => setMoreOpen((o) => !o)}
        >
          ⋯
        </button>
      </nav>
    </>
  )
}
```

- [ ] **Step 2: Render it in `App.tsx`**

Add `import { MobileDock } from './components/MobileDock'` and, directly after the `<Sidebar … />` line inside `.app__body`, add:

```tsx
<MobileDock page={page} onNavigate={navigate} />
```

- [ ] **Step 3: Replace the whole `@media (max-width: 720px)` block in `styles.css`**

Also add, OUTSIDE the media query, the dock base rules (hidden on desktop):

```css
/* Mobile dock — hidden on desktop */
.dock,
.dock-sheet,
.dock-sheet__backdrop {
  display: none;
}

/* ── Mobile (phones): floating pill dock, stacked layouts ───────────────── */
@media (max-width: 720px) {
  .app__main {
    padding: 16px 14px calc(84px + env(safe-area-inset-bottom));
  }

  .sidebar {
    display: none;
  }

  /* Floating pill dock (deliberately dark in BOTH themes) */
  .dock {
    display: flex;
    position: fixed;
    left: 14px;
    right: 14px;
    bottom: calc(12px + env(safe-area-inset-bottom));
    z-index: 100;
    background: rgba(20, 22, 27, 0.94);
    border-radius: 99px;
    padding: 7px 9px;
    box-shadow: 0 8px 24px rgba(16, 24, 40, 0.35);
  }
  .dock__tab {
    flex: 1;
    min-height: 44px;
    background: none;
    border: none;
    border-radius: 99px;
    font-size: 20px;
    color: #8b8f98;
    cursor: pointer;
  }
  .dock__tab--active {
    background: var(--accent);
    color: var(--on-accent);
  }
  .dock-sheet__backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 99;
  }
  .dock-sheet {
    display: flex;
    flex-direction: column;
    gap: 2px;
    position: fixed;
    right: 14px;
    bottom: calc(72px + env(safe-area-inset-bottom));
    z-index: 101;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md);
    padding: 6px;
    min-width: 160px;
  }
  .dock-sheet__item {
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 14px;
    font-family: inherit;
    text-align: left;
    padding: 12px 14px;
    border-radius: 6px;
    cursor: pointer;
    min-height: 44px;
  }
  .dock-sheet__item:hover {
    background: var(--bg-elevated);
  }

  /* Tap targets ≥ 44px, no iOS zoom-on-focus */
  .btn,
  .icon-btn,
  .text-input {
    min-height: 44px;
  }
  .text-input {
    font-size: 16px;
  }
  .link-btn {
    padding: 10px 4px;
  }

  /* Week Board → stacked day list */
  .board {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .board-card {
    flex-direction: row;
    align-items: center;
    min-height: 56px;
  }
  .board-card__open {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    flex: 1;
  }
  .board-card__image {
    width: 56px;
    height: 46px;
    border-radius: 6px;
    margin: 5px 0 5px 6px;
    flex-shrink: 0;
  }
  .board-card__btns {
    display: flex;
    position: static;
    margin-right: 6px;
  }
  .board-cell__editor {
    position: static;
    width: 100%;
    margin-top: 6px;
  }

  /* Tracker: hero compresses, meal grid single column */
  .hero-card {
    gap: 16px;
    padding: 14px 16px;
  }
  .cal-ring {
    width: 84px;
    height: 84px;
  }
  .cal-ring__inner {
    width: 64px;
    height: 64px;
  }
  .cal-ring__value {
    font-size: 15px;
  }
  .meal-grid {
    grid-template-columns: 1fr;
  }
  .tracker-profile-name {
    display: none;
  }

  /* Recipe detail: photo card full-width above title */
  .detail__hero {
    flex-direction: column;
  }
  .detail__image {
    width: 100%;
    height: 200px;
  }
  .detail__columns {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .recipe-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
  .modal {
    width: calc(100vw - 24px);
    max-height: 85vh;
  }
}
```

- [ ] **Step 4: Verify + commit**

```bash
npm run typecheck:web && npm run test:run
git add src/renderer/components/MobileDock.tsx src/renderer/App.tsx src/renderer/styles.css
git commit -m "feat(ui): floating pill dock + More sheet, Studio mobile layouts"
```

---

### Task 11: PWA manifest colors, builds, and full visual verification

**Files:**
- Modify: `vite.config.ts:26-27` (manifest colors)

- [ ] **Step 1: Update the PWA manifest** in `vite.config.ts`:

```ts
        theme_color: '#f2f4f7',
        background_color: '#f2f4f7',
```

- [ ] **Step 2: Full check suite**

```bash
npm run typecheck && npm run test:run && npm run lint
# Expected: all clean / all pass
npm run build:web   # Expected: dist-web builds clean
npm run build       # Expected: Electron build clean
```

- [ ] **Step 3: Visual verification (dev server + browser)**

```bash
npm run dev:web   # serves the PWA renderer locally
```

Check at desktop width AND ~390px width, in light AND dark (toggle via the new Settings → Appearance control, and via OS setting for system-follow):

- [ ] Sidebar floats; Ember pill on active item; all six destinations work
- [ ] Library: card grid, hover lift, title clamp, placeholder for imageless recipes
- [ ] Meal Plan: 7-column board; today ring; add/edit popover works (recipe pick, free text via Enter, Escape); clear; partner view read-only (dashed blanks, no editor)
- [ ] Tracker: ring % matches calories/goal; over-goal turns value red; bars blue/green/amber; date nav; add food modal opens
- [ ] Recipe Detail: card hero, chips, floating ingredient/step panels, servings stepper, cooking mode restyled
- [ ] Mobile (≤720px): pill dock floats with safe-area gap; active Ember circle; More sheet opens Import/Settings; board stacks to day list; ring card compresses; no input zoom (16px)
- [ ] Dark theme: hairline borders on panels, readable accent text (`--accent-deep`), scrim modals

- [ ] **Step 4: Commit + finish**

```bash
git add vite.config.ts
git commit -m "feat(ui): Studio PWA manifest colors"
```

Then use the `superpowers:finishing-a-development-branch` skill: verify, fast-forward merge `feat/studio-redesign` → `main`, confirm with Harrison before any push (Vercel deploys from `main`).

---

## Self-review notes

- **Spec coverage:** tokens/light+dark (T1), theme manager + system-follow + Settings override (T2, T9), Inter (T1), shared controls + segmented pill PersonSwitcher (T3), shell (T4), Library (T5), Card Hero detail (T6), Week Board + mobile stack (T7, T10), Ring Dashboard + macro colors (T8), remaining pages + cooking/modals (T3, T9), pill dock + More sheet + safe areas (T10), manifest colors (T11), verification (T11). Out-of-scope items untouched. ✓
- **Types:** `ThemePref` defined T2, used T9; `Page` from App used by MobileDock; `DayCell`/`CellActions` self-contained in T7; `MacroBar` signature unchanged (color prop swapped at call site). ✓
- **No placeholders:** every code step carries the real code; CSS blocks not restated are explicitly marked "keep existing rules". ✓
