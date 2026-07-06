# Instagram Recipe Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste an Instagram reel link (desktop or phone) and get a draft recipe in the existing review form — caption parsed heuristically, or the caption's blog link fed through the existing scraper.

**Architecture:** The desktop Electron app fetches reel metadata locally via `python -m yt_dlp` behind one new IPC channel (Instagram blocks datacenter IPs, so this can't live on Vercel). A shared pure-TS caption parser turns caption text into a `DraftRecipe`. The phone relays through a new Supabase `import_queue` table: phone inserts the URL, the desktop app (whenever open) fetches captions and writes them back, the phone parses and reviews via realtime. Spec: `docs/superpowers/specs/2026-07-06-instagram-import-design.md`.

**Tech Stack:** Electron IPC (`ipcMain.handle`/`contextBridge`), child_process spawn of `python -m yt_dlp`, Supabase (table + RLS + realtime), React, vitest.

**Conventions:** All commands run from the repo root (`recipe-vault/`). Tests live in `tests/` and use the in-memory Supabase mock pattern from `tests/data-tracker.test.ts`. Commit after every green task. Work on branch `feat/instagram-import`.

---

### Task 0: Branch

- [ ] **Step 0.1: Create the feature branch**

```bash
git checkout -b feat/instagram-import
```

---

### Task 1: Shared types + IPC constant

**Files:**
- Modify: `src/shared/types.ts`

No test — type-only additions; the compiler is the test.

- [ ] **Step 1.1: Add the Instagram/import-queue types**

In `src/shared/types.ts`, after the `MergedGroceryItem`/`GroceryItem` block (around line 78), add:

```ts
// ── instagram import ──────────────────────────────────────────────────────────

/** What the desktop yt-dlp fetch returns for a reel. */
export interface InstagramPost {
  caption: string
  uploader: string | null
}

export type ImportQueueStatus = 'pending' | 'fetched' | 'failed'

/** One phone-submitted reel waiting for (or processed by) the desktop fetcher. */
export interface ImportQueueItem {
  id: number
  ownerId: string
  url: string
  status: ImportQueueStatus
  caption: string | null
  uploader: string | null
  error: string | null
  createdAt: string
}
```

- [ ] **Step 1.2: Add the IPC channel name**

In the `IPC` const in the same file, after `SCRAPE_URL: 'scrape-url',` add:

```ts
  INSTAGRAM_FETCH: 'instagram-fetch',
```

- [ ] **Step 1.3: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/shared/types.ts
git commit -m "feat(types): instagram post + import queue types, IPC channel"
```

---

### Task 2: Caption → recipe parser (shared, TDD)

**Files:**
- Create: `src/shared/caption-recipe.ts`
- Test: `tests/caption-recipe.test.ts`

The heart of the feature. Test data is (lightly trimmed) real captions captured by the 2026-07-06 feasibility spike.

- [ ] **Step 2.1: Write the failing tests**

Create `tests/caption-recipe.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractFirstUrl, parseCaptionRecipe } from '../src/shared/caption-recipe'

// Real captions from the 2026-07-06 feasibility spike (trimmed).
const FULL_RECIPE_CAPTION = `⇩ Full Recipe 🍗 ⇩

Macros per 1 meal prep:
Protein: 42g
Calories: 573

Ingredients per 2 servings (makes 2 meal preps):

Chicken:
- 11oz chicken thigh, boneless, skinless, raw
- 1/2 tsp salt
- 3/4 cup Panko Breadcrumbs

Batter:
- 1 egg
- 1/4 cup flour
- 1.5 tbsp water

How to make it yourself:
1. Chop your cabbage into small pieces
2. Season your chicken thighs with salt and pepper.
3. Pour panko breadcrumbs on a plate. Fully dip the chicken thighs into the batter,
place it on top of the panko breadcrumbs and mix until fully coated.
4. Cook for 360°F for 10 min then flip & cook for another 7-10 minutes.

📩 Save this chicken katsu meal prep recipe to make for later!

#highprotein #mealprep`

const EMOJI_BULLET_CAPTION = `Follow for more!

You're not going to stick to plain chicken and rice forever… so make fat loss food that actually tastes good 👀🍗

This low calorie popcorn chicken is crispy, high protein and stupidly easy to make!

Ingredients:
🍗 600g chicken thighs (sliced)
🫒 1 tbsp oil
🌽 50g cornflour
🧂 Salt & pepper

🔥 Air fry for 20 mins`

const LINK_ONLY_CAPTION = `I had loads of Chicken Katsu in Hawaii but everytime I make my recipe at home I'm reminded of how incredible it is!

Comment "CJ Recipe" for the full recipe with all of my KEY tips sent straight to your inbox!

https://cjeatsrecipes.com/chicken-katsu/

#chicken #easyrecipes`

const NO_RECIPE_CAPTION = `I think it might be time to open a shop 🥪🤠`

describe('extractFirstUrl', () => {
  it('finds the first link and trims trailing punctuation', () => {
    expect(extractFirstUrl(LINK_ONLY_CAPTION)).toBe('https://cjeatsrecipes.com/chicken-katsu/')
    expect(extractFirstUrl('see https://example.com/recipe. Enjoy!')).toBe(
      'https://example.com/recipe'
    )
  })
  it('returns null when there is no link', () => {
    expect(extractFirstUrl(NO_RECIPE_CAPTION)).toBeNull()
  })
})

describe('parseCaptionRecipe', () => {
  it('parses a full caption recipe: header ingredients, numbered steps, servings', () => {
    const d = parseCaptionRecipe(FULL_RECIPE_CAPTION, 'Joe Chu')
    expect(d).not.toBeNull()
    expect(d!.confidence).toBe('heuristic')
    expect(d!.servings).toBe(2)
    expect(d!.imageUrl).toBeNull()
    // Section subheaders ("Chicken:", "Batter:") are skipped; macro lines are not ingredients.
    const names = d!.ingredients.map((i) => i.raw)
    expect(names).toContain('11oz chicken thigh, boneless, skinless, raw')
    expect(names).toContain('1 egg')
    expect(names).not.toContain('Chicken:')
    expect(names.some((n) => /protein/i.test(n))).toBe(false)
    // A quantity actually parsed
    const salt = d!.ingredients.find((i) => /salt/.test(i.raw) && i.quantity !== null)
    expect(salt?.quantity).toBe(0.5)
    expect(salt?.unit).toBe('tsp')
    // Steps: numbered, wrapped continuation folded into step 3
    expect(d!.steps).toHaveLength(4)
    expect(d!.steps[2].text).toMatch(/mix until fully coated/)
    // Junk title lines (CTA / macros) skipped → uploader fallback
    expect(d!.title).toBe('Instagram recipe — Joe Chu')
  })

  it('parses emoji-bulleted ingredients under an Ingredients header', () => {
    const d = parseCaptionRecipe(EMOJI_BULLET_CAPTION, 'Aimee Witkin | Online Coach')
    expect(d).not.toBeNull()
    const raws = d!.ingredients.map((i) => i.raw)
    expect(raws).toContain('600g chicken thighs (sliced)')
    expect(raws).toContain('Salt & pepper')
    const chicken = d!.ingredients.find((i) => i.raw.startsWith('600g'))
    expect(chicken?.quantity).toBe(600)
    expect(chicken?.unit).toBe('g')
    // Uploader fallback truncates at the "|"
    expect(d!.title).toBe('Instagram recipe — Aimee Witkin')
    // Long prose line becomes the description
    expect(d!.description).toMatch(/plain chicken and rice/)
  })

  it('returns null when the caption has no recipe', () => {
    expect(parseCaptionRecipe(NO_RECIPE_CAPTION, 'Fraser')).toBeNull()
    expect(parseCaptionRecipe(LINK_ONLY_CAPTION, 'Chris Joe')).toBeNull()
  })
})
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `npx vitest run tests/caption-recipe.test.ts`
Expected: FAIL — cannot resolve `../src/shared/caption-recipe`.

- [ ] **Step 2.3: Implement the parser**

Create `src/shared/caption-recipe.ts`:

```ts
import { parseIngredient } from './ingredient-parser'
import type { DraftRecipe, RecipeIngredient, RecipeStep } from './types'

const URL_RE = /https?:\/\/[^\s)\]]+/
const INGREDIENTS_HEADER = /^ingredients\b/i
const STEPS_HEADER = /^(how to|method|instructions|directions|steps)\b/i
const NUMBERED = /^(\d+)[.):]\s+(.*)$/
// Lines that are calls-to-action / engagement bait, never titles or content.
const CTA = /follow|comment|link in bio|full recipe|save this|cookbook|pre-?order|tag me|inbox/i
const HASHTAGS = /^#\w/

export function extractFirstUrl(text: string): string | null {
  const m = text.match(URL_RE)
  return m ? m[0].replace(/[.,;!?]+$/, '') : null
}

/** Strip leading bullets: emoji, dashes, dots, arrows — anything before a letter or digit. */
function stripBullet(line: string): string {
  return line.replace(/^[^\p{L}\p{N}]+/u, '').trim()
}

/**
 * Best-effort caption → draft recipe. Returns null when the caption holds no
 * recipe (video-only reels). Confidence is always 'heuristic' — the review
 * form labels it as a best guess.
 */
export function parseCaptionRecipe(caption: string, uploader: string | null): DraftRecipe | null {
  const rawLines = caption.split('\n').map((l) => l.trim())
  const lines = rawLines.map(stripBullet)

  let ingHeader = -1
  let stepsHeader = -1
  for (let i = 0; i < lines.length; i++) {
    if (ingHeader === -1 && INGREDIENTS_HEADER.test(lines[i])) ingHeader = i
    if (stepsHeader === -1 && STEPS_HEADER.test(lines[i])) stepsHeader = i
  }

  // ── ingredients ────────────────────────────────────────────────────────────
  const ingredients: RecipeIngredient[] = []
  const takeIngredient = (i: number): void => {
    const s = lines[i]
    if (!s || s.length > 120 || URL_RE.test(rawLines[i]) || HASHTAGS.test(rawLines[i])) return
    if (s.endsWith(':')) return // section subheader ("Batter:") — keep the list flat
    ingredients.push({ ...parseIngredient(s), position: ingredients.length })
  }
  if (ingHeader !== -1) {
    // Everything under the header until steps begin or hashtags start.
    for (let i = ingHeader + 1; i < lines.length; i++) {
      if (i === stepsHeader || NUMBERED.test(lines[i]) || HASHTAGS.test(rawLines[i])) break
      takeIngredient(i)
    }
  } else {
    // No header: longest run of consecutive bulleted/quantity lines (≥2 with quantities).
    let best: number[] = []
    let run: number[] = []
    const flush = (): void => {
      const q = run.filter((i) => parseIngredient(lines[i]).quantity !== null).length
      if (q >= 2 && run.length > best.length) best = run
      run = []
    }
    for (let i = 0; i < lines.length; i++) {
      const bulleted = lines[i] !== '' && rawLines[i] !== lines[i]
      const hasQty = lines[i] !== '' && parseIngredient(lines[i]).quantity !== null
      if ((hasQty || bulleted) && !NUMBERED.test(lines[i]) && !STEPS_HEADER.test(lines[i])) {
        run.push(i)
      } else {
        flush()
      }
    }
    flush()
    for (const i of best) takeIngredient(i)
  }

  // ── steps: numbered lines, folding unnumbered continuation lines in ────────
  const steps: RecipeStep[] = []
  let current: string | null = null
  const push = (): void => {
    if (current) steps.push({ position: steps.length, section: null, text: current })
    current = null
  }
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(NUMBERED)
    if (m) {
      push()
      current = m[2]
    } else if (current !== null) {
      if (!lines[i] || HASHTAGS.test(rawLines[i])) push()
      else current += ' ' + lines[i]
    }
  }
  push()

  if (ingredients.length === 0 && steps.length === 0) return null

  // ── title: first short, non-CTA, non-macro line before the ingredients ─────
  const stopAt = ingHeader !== -1 ? ingHeader : lines.length
  let title = ''
  for (let i = 0; i < stopAt; i++) {
    const s = lines[i]
    if (!s || s.length > 60 || s.endsWith(':')) continue
    if (CTA.test(s) || /^\w+:\s/.test(s)) continue // engagement bait / "Protein: 42g"
    if (URL_RE.test(rawLines[i]) || HASHTAGS.test(rawLines[i])) continue
    if (parseIngredient(s).quantity !== null) continue
    title = s
    break
  }
  if (!title) {
    const short = uploader?.split('|')[0].trim()
    title = short ? `Instagram recipe — ${short}` : 'Instagram recipe'
  }

  // ── description: first substantial prose line before the ingredients ───────
  let description = ''
  for (let i = 0; i < stopAt; i++) {
    const s = lines[i]
    if (s.length >= 40 && !CTA.test(s) && !HASHTAGS.test(rawLines[i]) && !URL_RE.test(rawLines[i])) {
      description = s
      break
    }
  }

  const servingsM = caption.match(/(\d+)\s*servings?/i)

  return {
    title,
    sourceUrl: null, // caller sets the reel URL
    imageUrl: null, // Instagram CDN thumbnails are signed and expire — never hot-link
    description,
    servings: servingsM ? Number(servingsM[1]) : null,
    prepMin: null,
    cookMin: null,
    totalMin: null,
    ingredients,
    steps,
    confidence: 'heuristic'
  }
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `npx vitest run tests/caption-recipe.test.ts`
Expected: PASS (3 describe blocks, 5 tests). If a heuristic assertion fails, fix the parser — not the test — unless the expectation itself misreads the fixture.

- [ ] **Step 2.5: Commit**

```bash
git add src/shared/caption-recipe.ts tests/caption-recipe.test.ts
git commit -m "feat(import): caption->recipe heuristic parser + url extraction"
```

---

### Task 3: `import_queue` schema

**Files:**
- Modify: `supabase/schema.sql`

SQL only — verified by re-running the file in Supabase at hand-off (idempotent).

- [ ] **Step 3.1: Add the table**

In `supabase/schema.sql`, directly after the `grocery_items` create-table block, add:

```sql
-- Instagram import relay: the phone inserts a reel URL; the desktop app (the only
-- device on a residential IP that can talk to Instagram) fetches the caption and
-- writes it back; the submitter's device parses it and opens the review form.
-- Transient work queue — rows are deleted after review.
create table if not exists public.import_queue (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url        text not null,
  status     text not null default 'pending' check (status in ('pending','fetched','failed')),
  caption    text,
  uploader   text,
  error      text,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 3.2: Add RLS policies**

After the existing read-all/write-own policy `do $$` loop (which covers recipes/ingredients/steps/meal_plan), add a dedicated block:

```sql
-- import_queue: household read + household UPDATE (the desktop app is signed in as
-- one user but must serve the other's queued fetches too); insert/delete stay owner-only.
alter table public.import_queue enable row level security;
drop policy if exists "import_queue: household read"   on public.import_queue;
drop policy if exists "import_queue: owner insert"     on public.import_queue;
drop policy if exists "import_queue: household update" on public.import_queue;
drop policy if exists "import_queue: owner delete"     on public.import_queue;
create policy "import_queue: household read"   on public.import_queue for select to authenticated using (true);
create policy "import_queue: owner insert"     on public.import_queue for insert to authenticated with check (owner_id = auth.uid());
create policy "import_queue: household update" on public.import_queue for update to authenticated using (true) with check (true);
create policy "import_queue: owner delete"     on public.import_queue for delete to authenticated using (owner_id = auth.uid());
```

- [ ] **Step 3.3: Add to the realtime publication**

In the realtime `do $$` block near the end of the file, extend the array:

```sql
  foreach t in array array['recipes','ingredients','steps','meal_plan','grocery_items','food_log','profiles','import_queue']
```

- [ ] **Step 3.4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(schema): import_queue table, household-update RLS, realtime"
```

---

### Task 4: Queue data layer (TDD)

**Files:**
- Create: `src/renderer/data/importQueue.ts`
- Test: `tests/data-import-queue.test.ts`

- [ ] **Step 4.1: Write the failing tests**

Create `tests/data-import-queue.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  queueImport,
  listMyImports,
  processPending,
  retryImport,
  deleteImport
} from '../src/renderer/data/importQueue'
import type { InstagramPost, IpcResult } from '../src/shared/types'

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as { patch: Record<string, unknown>; id: number }[],
  deletedIds: [] as number[]
}))

vi.mock('../src/renderer/data/supabase', () => {
  const chain = (data: unknown): Record<string, unknown> => {
    const result = { data, error: null }
    const node: Record<string, unknown> = {
      then: (ok: (r: unknown) => unknown) => Promise.resolve(result).then(ok)
    }
    for (const m of ['select', 'eq', 'order']) node[m] = () => chain(data)
    return node
  }
  return {
    supabase: {
      from: () => ({
        select: () => chain(state.rows),
        insert: (row: Record<string, unknown>) => {
          state.inserted.push(row)
          return Promise.resolve({ error: null })
        },
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: number) => {
            state.updated.push({ patch, id })
            return Promise.resolve({ error: null })
          }
        }),
        delete: () => ({
          eq: (_c: string, id: number) => {
            state.deletedIds.push(id)
            return Promise.resolve({ error: null })
          }
        })
      })
    }
  }
})

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    owner_id: 'user-1',
    url: 'https://www.instagram.com/reel/ABC123/',
    status: 'pending',
    caption: null,
    uploader: null,
    error: null,
    created_at: '2026-07-06T10:00:00Z',
    ...over
  }
}

beforeEach(() => {
  state.rows = []
  state.inserted = []
  state.updated = []
  state.deletedIds = []
})

describe('queueImport', () => {
  it('inserts the url (owner stamped by DB default)', async () => {
    await queueImport('https://www.instagram.com/reel/ABC123/')
    expect(state.inserted).toEqual([{ url: 'https://www.instagram.com/reel/ABC123/' }])
  })
})

describe('listMyImports', () => {
  it('maps snake_case rows to camelCase items', async () => {
    state.rows = [row({ status: 'fetched', caption: 'hello', uploader: 'Joe' })]
    const items = await listMyImports('user-1')
    expect(items).toEqual([
      {
        id: 1,
        ownerId: 'user-1',
        url: 'https://www.instagram.com/reel/ABC123/',
        status: 'fetched',
        caption: 'hello',
        uploader: 'Joe',
        error: null,
        createdAt: '2026-07-06T10:00:00Z'
      }
    ])
  })
})

describe('processPending', () => {
  it('fetches each pending row and marks success/failure', async () => {
    state.rows = [row({ id: 1 }), row({ id: 2, url: 'https://www.instagram.com/reel/XYZ/' })]
    const fetcher = async (url: string): Promise<IpcResult<InstagramPost>> =>
      url.includes('ABC123')
        ? { ok: true, data: { caption: 'the caption', uploader: 'Joe' } }
        : { ok: false, message: 'post may be private' }
    await processPending(fetcher)
    expect(state.updated).toEqual([
      { patch: { status: 'fetched', caption: 'the caption', uploader: 'Joe', error: null }, id: 1 },
      { patch: { status: 'failed', error: 'post may be private' }, id: 2 }
    ])
  })
})

describe('retry + delete', () => {
  it('retryImport resets a row to pending', async () => {
    await retryImport(7)
    expect(state.updated).toEqual([{ patch: { status: 'pending', error: null }, id: 7 }])
  })
  it('deleteImport deletes by id', async () => {
    await deleteImport(7)
    expect(state.deletedIds).toEqual([7])
  })
})
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `npx vitest run tests/data-import-queue.test.ts`
Expected: FAIL — cannot resolve `../src/renderer/data/importQueue`.

- [ ] **Step 4.3: Implement the data layer**

Create `src/renderer/data/importQueue.ts`:

```ts
import { supabase } from './supabase'
import type { ImportQueueItem, InstagramPost, IpcResult } from '../../shared/types'

const COLS = 'id, owner_id, url, status, caption, uploader, error, created_at'

function mapRow(r: Record<string, unknown>): ImportQueueItem {
  return {
    id: r.id as number,
    ownerId: r.owner_id as string,
    url: r.url as string,
    status: r.status as ImportQueueItem['status'],
    caption: (r.caption as string) ?? null,
    uploader: (r.uploader as string) ?? null,
    error: (r.error as string) ?? null,
    createdAt: r.created_at as string
  }
}

/** Phone side: queue a reel URL for the desktop app to fetch. */
export async function queueImport(url: string): Promise<void> {
  const { error } = await supabase.from('import_queue').insert({ url })
  if (error) throw new Error(error.message)
}

/** The signed-in user's own queue, newest first (drives the Import page list). */
export async function listMyImports(ownerId: string): Promise<ImportQueueItem[]> {
  const { data, error } = await supabase
    .from('import_queue')
    .select(COLS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapRow)
}

/** Desktop worker: ALL household pending rows, oldest first (RLS allows household update). */
async function listPendingImports(): Promise<ImportQueueItem[]> {
  const { data, error } = await supabase
    .from('import_queue')
    .select(COLS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapRow)
}

/**
 * Desktop worker sweep: fetch every pending reel serially (no parallel hammering
 * of Instagram) and write results back. `fetchPost` is the IPC bridge — injected
 * so this stays unit-testable.
 */
export async function processPending(
  fetchPost: (url: string) => Promise<IpcResult<InstagramPost>>
): Promise<void> {
  const pending = await listPendingImports()
  for (const item of pending) {
    const res = await fetchPost(item.url)
    const patch = res.ok
      ? { status: 'fetched', caption: res.data.caption, uploader: res.data.uploader, error: null }
      : { status: 'failed', error: res.message }
    const { error } = await supabase.from('import_queue').update(patch).eq('id', item.id)
    if (error) throw new Error(error.message)
  }
}

export async function retryImport(id: number): Promise<void> {
  const { error } = await supabase
    .from('import_queue')
    .update({ status: 'pending', error: null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteImport(id: number): Promise<void> {
  const { error } = await supabase.from('import_queue').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `npx vitest run tests/data-import-queue.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4.5: Commit**

```bash
git add src/renderer/data/importQueue.ts tests/data-import-queue.test.ts
git commit -m "feat(import): import_queue data layer + serial pending processor"
```

---

### Task 5: Electron fetcher — IPC handler, preload bridge, window typing

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Create: `src/renderer/window.d.ts`

No unit test (thin spawn wrapper around yt-dlp); verified end-to-end in Task 8.

- [ ] **Step 5.1: Add the IPC handler to main**

In `src/main/index.ts`, change the electron import to include `ipcMain`, add the spawn import and shared-type imports at the top:

```ts
import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { IPC } from '../shared/types'
import type { InstagramPost, IpcResult } from '../shared/types'
```

Then, above `createWindow`, add:

```ts
const IG_URL = /^https:\/\/(www\.)?instagram\.com\/(reel|reels|p|tv)\/[A-Za-z0-9_-]+\/?/

/**
 * Fetch a reel's caption via the locally installed yt-dlp (`python -m yt_dlp`).
 * Runs here (not on Vercel) because Instagram blocks datacenter IPs — the home
 * connection is the only place this works. No login/cookies needed for public posts.
 */
function fetchInstagram(url: string): Promise<IpcResult<InstagramPost>> {
  const clean = String(url).trim()
  if (!IG_URL.test(clean)) {
    return Promise.resolve({ ok: false, message: 'Not an Instagram post URL.' })
  }
  return new Promise((resolve) => {
    const proc = spawn(
      'python',
      ['-m', 'yt_dlp', '--skip-download', '--dump-json', '--no-warnings', clean],
      { windowsHide: true }
    )
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      proc.kill()
      resolve({ ok: false, message: 'Instagram fetch timed out (90s). Try again.' })
    }, 90_000)
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', () => {
      clearTimeout(timer)
      resolve({
        ok: false,
        message: 'Python not found — install Python, then run: pip install --user yt-dlp'
      })
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        const message = /no module named/i.test(err)
          ? 'yt-dlp is not installed — run: pip install --user yt-dlp'
          : 'Instagram fetch failed — the post may be private, or Instagram changed something. Try: pip install -U yt-dlp'
        resolve({ ok: false, message })
        return
      }
      try {
        const d = JSON.parse(out) as { description?: string; uploader?: string; channel?: string }
        resolve({
          ok: true,
          data: { caption: d.description ?? '', uploader: d.uploader ?? d.channel ?? null }
        })
      } catch {
        resolve({ ok: false, message: 'Could not read yt-dlp output.' })
      }
    })
  })
}
```

And inside `app.whenReady().then(async () => { … })`, before `await createWindow()`:

```ts
  ipcMain.handle(IPC.INSTAGRAM_FETCH, (_e, url: string) => fetchInstagram(url))
```

- [ ] **Step 5.2: Expose the bridge in preload**

Replace the whole of `src/preload/index.ts` with:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'

// The renderer talks to Supabase directly; the ONLY thing the desktop shell adds
// is the local Instagram fetcher (yt-dlp needs a residential IP + a real process).
// `window.api` being undefined is how the renderer detects the web/PWA build.
contextBridge.exposeInMainWorld('api', {
  fetchInstagram: (url: string) => ipcRenderer.invoke(IPC.INSTAGRAM_FETCH, url)
})
```

- [ ] **Step 5.3: Type `window.api` for the renderer**

Create `src/renderer/window.d.ts`:

```ts
import type { InstagramPost, IpcResult } from '../shared/types'

declare global {
  interface Window {
    /** Desktop (Electron) only — absent in the web/PWA build. */
    api?: {
      fetchInstagram(url: string): Promise<IpcResult<InstagramPost>>
    }
  }
}

export {}
```

- [ ] **Step 5.4: Typecheck, build, commit**

Run: `npm run typecheck`
Expected: clean.
Run: `npx electron-vite build`
Expected: main/preload/renderer all build.

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/window.d.ts
git commit -m "feat(desktop): instagram-fetch IPC via local yt-dlp + preload bridge"
```

---

### Task 6: Import orchestration (TDD)

**Files:**
- Create: `src/renderer/data/instagram.ts`
- Test: `tests/instagram-import.test.ts`

Decision order per spec: caption link → existing scraper (structured wins); else heuristic caption parse; else honest failure.

- [ ] **Step 6.1: Write the failing tests**

Create `tests/instagram-import.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isInstagramUrl, captionToDraft } from '../src/renderer/data/instagram'
import type { DraftRecipe, IpcResult } from '../src/shared/types'

const scrape = vi.hoisted(() => ({
  result: { ok: false, message: 'nope' } as IpcResult<DraftRecipe>,
  calls: [] as string[]
}))

vi.mock('../src/renderer/data/scrape', () => ({
  scrapeUrl: async (url: string) => {
    scrape.calls.push(url)
    return scrape.result
  }
}))

const REEL = 'https://www.instagram.com/reel/ABC123/'

function structuredDraft(): DraftRecipe {
  return {
    title: 'Chicken Katsu',
    sourceUrl: 'https://cjeatsrecipes.com/chicken-katsu/',
    imageUrl: 'https://cjeatsrecipes.com/img.jpg',
    description: 'Crispy katsu.',
    servings: 4,
    prepMin: null,
    cookMin: null,
    totalMin: 30,
    ingredients: [],
    steps: [],
    confidence: 'structured'
  }
}

beforeEach(() => {
  scrape.result = { ok: false, message: 'nope' }
  scrape.calls = []
})

describe('isInstagramUrl', () => {
  it('matches reels and posts, rejects other sites', () => {
    expect(isInstagramUrl(REEL)).toBe(true)
    expect(isInstagramUrl('https://instagram.com/p/XYZ/?utm_source=x')).toBe(true)
    expect(isInstagramUrl('https://www.bbcgoodfood.com/recipes/katsu')).toBe(false)
  })
})

describe('captionToDraft', () => {
  it('follows a caption link through the scraper; reel becomes sourceUrl, blog kept in description', async () => {
    scrape.result = { ok: true, data: structuredDraft() }
    const res = await captionToDraft(
      'Get the recipe: https://cjeatsrecipes.com/chicken-katsu/ #food',
      'Chris Joe',
      REEL
    )
    expect(scrape.calls).toEqual(['https://cjeatsrecipes.com/chicken-katsu/'])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.sourceUrl).toBe(REEL)
      expect(res.data.description).toContain('https://cjeatsrecipes.com/chicken-katsu/')
      expect(res.data.confidence).toBe('structured')
    }
  })

  it('falls back to the heuristic caption parse when the link scrape fails', async () => {
    const caption = `Popcorn chicken!\n\nIngredients:\n- 600g chicken thighs\n- 1 tbsp oil\n\nhttps://linktr.ee/someone`
    const res = await captionToDraft(caption, 'Aimee', REEL)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.confidence).toBe('heuristic')
      expect(res.data.sourceUrl).toBe(REEL)
      expect(res.data.ingredients.length).toBe(2)
    }
  })

  it('reports honestly when the caption has no recipe at all', async () => {
    const res = await captionToDraft('time to open a shop 🥪', 'Fraser', REEL)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toMatch(/only exists in the video/i)
  })
})
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `npx vitest run tests/instagram-import.test.ts`
Expected: FAIL — cannot resolve `../src/renderer/data/instagram`.

- [ ] **Step 6.3: Implement the orchestration**

Create `src/renderer/data/instagram.ts`:

```ts
import { scrapeUrl } from './scrape'
import { extractFirstUrl, parseCaptionRecipe } from '../../shared/caption-recipe'
import type { DraftRecipe, IpcResult } from '../../shared/types'

const IG_URL = /^https:\/\/(www\.)?instagram\.com\/(reel|reels|p|tv)\/[A-Za-z0-9_-]+/

export function isInstagramUrl(url: string): boolean {
  return IG_URL.test(url.trim())
}

/**
 * Caption → draft recipe, spec decision order:
 * 1. caption link → existing scraper (structured recipe data wins outright)
 * 2. heuristic caption parse (labelled best-guess by the review form)
 * 3. honest failure (video-only reels)
 * The reel stays `sourceUrl` (it's what was saved); a followed blog link is
 * appended to the description so it isn't lost.
 */
export async function captionToDraft(
  caption: string,
  uploader: string | null,
  reelUrl: string | null
): Promise<IpcResult<DraftRecipe>> {
  const link = extractFirstUrl(caption)
  if (link) {
    const scraped = await scrapeUrl(link)
    if (scraped.ok) {
      const note = `Recipe: ${link}`
      return {
        ok: true,
        data: {
          ...scraped.data,
          sourceUrl: reelUrl ?? scraped.data.sourceUrl,
          description: scraped.data.description ? `${scraped.data.description}\n\n${note}` : note
        }
      }
    }
  }
  const parsed = parseCaptionRecipe(caption, uploader)
  if (parsed) return { ok: true, data: { ...parsed, sourceUrl: reelUrl } }
  return {
    ok: false,
    message:
      'No recipe found in the caption — this one probably only exists in the video. You can enter it manually.'
  }
}

/** Desktop only: fetch via the local yt-dlp bridge, then parse. */
export async function importInstagramDesktop(url: string): Promise<IpcResult<DraftRecipe>> {
  const post = await window.api!.fetchInstagram(url)
  if (!post.ok) return post
  return captionToDraft(post.data.caption, post.data.uploader, url)
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `npx vitest run tests/instagram-import.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6.5: Commit**

```bash
git add src/renderer/data/instagram.ts tests/instagram-import.test.ts
git commit -m "feat(import): instagram caption->draft orchestration (link-follow, heuristic, honest fail)"
```

---

### Task 7: Desktop queue worker hook

**Files:**
- Create: `src/renderer/hooks/useImportQueueWorker.ts`
- Modify: `src/renderer/App.tsx`

The sweep logic (`processPending`) is already tested in Task 4; the hook is a thin mount wrapper — compiler-verified.

- [ ] **Step 7.1: Create the hook**

Create `src/renderer/hooks/useImportQueueWorker.ts`:

```ts
import { useEffect } from 'react'
import { processPending } from '../data/importQueue'
import { onTableChange } from '../data/realtime'

/**
 * Desktop only: serve the household's queued Instagram fetches. Sweeps pending
 * rows on mount (catches anything queued while the PC was off), then re-sweeps
 * whenever the queue changes. Re-entrancy guard: one sweep at a time; a change
 * arriving mid-sweep schedules exactly one follow-up.
 */
export function useImportQueueWorker(): void {
  useEffect(() => {
    const api = window.api
    if (!api) return // web/PWA build — the phone is a queue producer, not a worker
    let busy = false
    let again = false
    const sweep = async (): Promise<void> => {
      if (busy) {
        again = true
        return
      }
      busy = true
      try {
        await processPending(api.fetchInstagram)
      } catch {
        // transient (offline, RLS during sign-out) — the next queue change retries
      }
      busy = false
      if (again) {
        again = false
        void sweep()
      }
    }
    void sweep()
    return onTableChange(['import_queue'], () => void sweep())
  }, [])
}
```

- [ ] **Step 7.2: Mount it in App**

In `src/renderer/App.tsx`, add the import:

```ts
import { useImportQueueWorker } from './hooks/useImportQueueWorker'
```

and call it as the first hook inside `App()` (App only renders signed-in, inside AuthGate):

```ts
  useImportQueueWorker()
```

- [ ] **Step 7.3: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/renderer/hooks/useImportQueueWorker.ts src/renderer/App.tsx
git commit -m "feat(desktop): background worker serves queued instagram fetches"
```

---

### Task 8: Import page UI

**Files:**
- Modify: `src/renderer/pages/ImportPage.tsx`
- Modify: `src/renderer/styles.css`

Routes Instagram URLs (desktop → direct IPC; web → queue), lists queue items with live status, auto-opens the review form when this session's submission comes back, and offers the paste-a-caption fallback. Compiler + manual verification (Task 9).

- [ ] **Step 8.1: Rewrite ImportPage**

Replace `src/renderer/pages/ImportPage.tsx` with:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DraftRecipe, ImportQueueItem, IpcResult } from '../../shared/types'
import { scrapeUrl } from '../data/scrape'
import { isInstagramUrl, importInstagramDesktop, captionToDraft } from '../data/instagram'
import { queueImport, listMyImports, retryImport, deleteImport } from '../data/importQueue'
import { onTableChange } from '../data/realtime'
import { useHousehold } from '../hooks/useHousehold'
import { RecipeReviewForm } from '../components/RecipeReviewForm'

const EMPTY_DRAFT: DraftRecipe = {
  title: '',
  sourceUrl: null,
  imageUrl: null,
  description: '',
  servings: null,
  prepMin: null,
  cookMin: null,
  totalMin: null,
  ingredients: [],
  steps: [],
  confidence: 'manual'
}

const STATUS_LABEL: Record<ImportQueueItem['status'], string> = {
  pending: 'Waiting for your desktop app…',
  fetched: 'Ready to review',
  failed: 'Failed'
}

export function ImportPage(props: { onSaved: (id: number) => void }): JSX.Element {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftRecipe | null>(null)
  const [captionOpen, setCaptionOpen] = useState(false)
  const [captionText, setCaptionText] = useState('')
  const [queue, setQueue] = useState<ImportQueueItem[]>([])
  // Queue row currently open in the review form — deleted once saved.
  const [reviewingId, setReviewingId] = useState<number | null>(null)
  // URL submitted this session; when its row comes back fetched, auto-open review.
  const autoOpenUrl = useRef<string | null>(null)

  const users = useHousehold()
  const meId = users.find((u) => u.isMe)?.id ?? null

  const openFetchedItem = useCallback(
    async (item: ImportQueueItem): Promise<void> => {
      setLoading(true)
      const res = await captionToDraft(item.caption ?? '', item.uploader, item.url)
      setLoading(false)
      if (res.ok) {
        setReviewingId(item.id)
        setDraft(res.data)
      } else {
        setError(res.message)
      }
    },
    [setLoading, setDraft, setError]
  )

  const reloadQueue = useCallback(() => {
    if (!meId) return
    listMyImports(meId).then((items) => {
      setQueue(items)
      const wanted = autoOpenUrl.current
      if (wanted) {
        const hit = items.find((i) => i.url === wanted && i.status === 'fetched')
        if (hit) {
          autoOpenUrl.current = null
          void openFetchedItem(hit)
        }
      }
    })
  }, [meId, openFetchedItem])

  useEffect(() => {
    reloadQueue()
    return onTableChange(['import_queue'], reloadQueue)
  }, [reloadQueue])

  const fetchRecipe = async (): Promise<void> => {
    const u = url.trim()
    if (!u) return
    setLoading(true)
    setError(null)
    let result: IpcResult<DraftRecipe>
    if (isInstagramUrl(u)) {
      if (window.api) {
        result = await importInstagramDesktop(u)
      } else {
        // Phone/web: hand the fetch to the desktop app via the queue.
        try {
          await queueImport(u)
          autoOpenUrl.current = u
          setUrl('')
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not queue the import.')
        }
        setLoading(false)
        return
      }
    } else {
      result = await scrapeUrl(u)
    }
    setLoading(false)
    if (result.ok) setDraft(result.data)
    else setError(result.message)
  }

  const parseCaption = async (): Promise<void> => {
    const text = captionText.trim()
    if (!text) return
    setLoading(true)
    setError(null)
    const source = isInstagramUrl(url.trim()) ? url.trim() : null
    const res = await captionToDraft(text, null, source)
    setLoading(false)
    if (res.ok) {
      setDraft(res.data)
      setCaptionText('')
      setCaptionOpen(false)
    } else {
      setError(res.message)
    }
  }

  if (draft) {
    return (
      <RecipeReviewForm
        draft={draft}
        onCancel={() => {
          setDraft(null)
          setReviewingId(null)
        }}
        onSaved={(id) => {
          if (reviewingId !== null) {
            void deleteImport(reviewingId)
            setReviewingId(null)
          }
          props.onSaved(id)
        }}
      />
    )
  }

  return (
    <div className="import-page">
      <h2 className="page-header__title">Import a recipe</h2>
      <p className="import-page__hint">
        Paste a link to any recipe page — or an Instagram reel. RecipeVault strips it down to just
        the ingredients and steps — no ads, no life stories.
        {!window.api && ' Instagram links are fetched by your desktop app and appear below.'}
      </p>
      <div className="import-page__row">
        <input
          className="text-input import-page__url"
          placeholder="https://www.instagram.com/reel/… or any recipe page"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchRecipe()}
          disabled={loading}
        />
        <button
          className="btn btn--primary"
          onClick={fetchRecipe}
          disabled={loading || !url.trim()}
        >
          {loading ? 'Fetching…' : 'Fetch recipe'}
        </button>
      </div>
      {error && (
        <div className="banner banner--error">
          <span>{error}</span>
          <button className="btn" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            Enter manually
          </button>
        </div>
      )}

      {queue.length > 0 && (
        <ul className="import-queue">
          {queue.map((item) => (
            <li key={item.id} className={`import-queue__item import-queue__item--${item.status}`}>
              <div className="import-queue__info">
                <span className="import-queue__url">{item.url}</span>
                <span className="import-queue__status">
                  {STATUS_LABEL[item.status]}
                  {item.status === 'failed' && item.error ? ` — ${item.error}` : ''}
                </span>
              </div>
              {item.status === 'fetched' && (
                <button className="btn btn--primary" onClick={() => void openFetchedItem(item)}>
                  Review
                </button>
              )}
              {item.status === 'failed' && (
                <button className="btn" onClick={() => void retryImport(item.id)}>
                  Retry
                </button>
              )}
              <button
                className="icon-btn"
                title="Remove"
                onClick={() => void deleteImport(item.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="import-page__manual">
        …or{' '}
        <button className="link-btn" onClick={() => setCaptionOpen(!captionOpen)}>
          paste an Instagram caption
        </button>{' '}
        ·{' '}
        <button className="link-btn" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          enter a recipe manually
        </button>
      </p>
      {captionOpen && (
        <div className="import-page__caption">
          <textarea
            className="text-input import-page__caption-box"
            rows={8}
            placeholder="Paste the reel's caption here…"
            value={captionText}
            onChange={(e) => setCaptionText(e.target.value)}
            disabled={loading}
          />
          <button
            className="btn btn--primary"
            onClick={parseCaption}
            disabled={loading || !captionText.trim()}
          >
            Read recipe from caption
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 8.2: Add the queue/caption styles**

In `src/renderer/styles.css`, after the existing `.import-page__manual` rules (search for `import-page`), add:

```css
/* Instagram import queue (phone submits, desktop fetches) */
.import-queue {
  list-style: none;
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
}
.import-queue__item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 12px;
}
.import-queue__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.import-queue__url {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.import-queue__status {
  font-size: 11px;
  color: var(--text-muted);
}
.import-queue__item--fetched .import-queue__status {
  color: var(--green);
}
.import-queue__item--failed .import-queue__status {
  color: var(--red, #c0392b);
}
.import-page__caption {
  margin-top: 10px;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.import-page__caption-box {
  width: 100%;
  resize: vertical;
  font-family: inherit;
}
```

(Check that `--red` exists near the `--green` custom property; if the theme defines a different name for the error colour, use that instead of the fallback.)

- [ ] **Step 8.3: Typecheck, full test run, commit**

Run: `npm run typecheck`
Expected: clean.
Run: `npx vitest run`
Expected: all tests pass (75 existing + 12 new = 87, exact count may vary).

```bash
git add src/renderer/pages/ImportPage.tsx src/renderer/styles.css
git commit -m "feat(import): instagram-aware import page — queue list, live status, caption fallback"
```

---

### Task 9: README, verification, real-reel end-to-end

**Files:**
- Modify: `README.md` (dependency + feature note)

- [ ] **Step 9.1: Document the dependency**

In `README.md`, add to the setup/features section (match the file's existing tone):

```markdown
### Instagram import (desktop)

Importing from Instagram reels uses a locally installed [yt-dlp](https://github.com/yt-dlp/yt-dlp):

```
pip install --user yt-dlp
```

Instagram blocks datacenter IPs, so reel fetching only runs in the desktop app (home
connection). Phone imports queue through Supabase and are fetched next time the
desktop app is open. If Instagram imports suddenly fail, update it:
`pip install -U yt-dlp`.
```

- [ ] **Step 9.2: Full verification**

Run: `npm run typecheck` — expected clean.
Run: `npx vitest run` — expected all green.
Run: `npm run lint` — expected 0 errors (CRLF warnings are pre-existing).
Run: `npm run build:web` — expected clean build.
Run: `npx electron-vite build` — expected clean build.

- [ ] **Step 9.3: End-to-end with a real reel (desktop)**

Start the desktop app (`npm run dev`), go to Import, paste
`https://www.instagram.com/reel/DYV3-9RgT-a/` (known full-caption recipe from the
spike), click Fetch recipe. Expected: review form opens with ingredients + steps,
confidence badge shows best-guess. Do NOT save unless wanted — cancel is fine.
Also paste `https://www.instagram.com/reel/DZF6rj6pmHZ/` (link-in-caption reel).
Expected: structured Chicken Katsu draft with the reel as source.

- [ ] **Step 9.4: Commit**

```bash
git add README.md
git commit -m "docs: instagram import setup (yt-dlp) + phone queue behaviour"
```

---

## Hand-off after implementation

1. Harrison re-runs `supabase/schema.sql` in the dashboard (additive; only the usual
   drop-policy warnings) BEFORE the push.
2. Fast-forward merge `feat/instagram-import` → `main`, plain push → Vercel deploys.
3. Phone-path verification: queue a reel from the phone PWA with the desktop app
   open; the status card should flip to "Ready to review" within seconds.
```
