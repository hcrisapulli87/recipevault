# Readable Food Search Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Add Food search results into rows a human can read at a glance — plain-English titles for generic AFCD foods, a labelled split between generic and branded blocks, a capped generic block — and fix the kilojoule-only branded products that currently log as 0 kcal.

**Architecture:** One new pure module, `src/shared/food-label.ts`, converts a `FoodItem` into `{ title, detail }` using four small lexicons over the AFCD tail vocabulary. It is display-only: `food_log` keeps storing `item.name`, so recents dedupe, the barcode cache and existing rows are untouched. `AddFoodModal` consumes it in `FoodRow` and partitions results by `item.source`. The kJ fix is a self-contained change inside `mapOffProduct`.

**Tech Stack:** TypeScript, React 18, Vite/electron-vite, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-food-result-labels-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/shared/food-label.ts` | Create | Pure `foodLabel(item) → { title, detail }`. Lexicons, title assembly, cap. No imports beyond `../shared/types`. |
| `tests/food-label.test.ts` | Create | Per-lexicon cases, category-head rule, cap, branded passthrough, corpus invariant over all 1,588 AFCD names. |
| `src/shared/nutrition.ts` | Modify | `OffProduct` gains the kJ keys; `mapOffProduct` derives kcal from kJ. |
| `tests/nutrition.test.ts` | Modify | kJ-only product, kcal-wins, neither-unit cases. |
| `src/renderer/components/AddFoodModal.tsx` | Modify | `FoodRow` renders `foodLabel`; results partitioned into two labelled blocks; 6-row cap with expander. |
| `src/renderer/styles.css` | Modify | One-line truncation on `.food-row__sub`, styling for the show-more button. |

`food-label.ts` lives in `shared/` (not `renderer/`) for the same reason
`nutrition.ts` does: it is pure logic the tests import directly without a DOM.

---

### Task 1: `foodLabel` — branded passthrough and the plain split

The smallest useful behaviour: branded items keep their name, generic items get
their head promoted to the title and the rest demoted. Lexicons come next.

**Files:**
- Create: `src/shared/food-label.ts`
- Test: `tests/food-label.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/food-label.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { foodLabel } from '../src/shared/food-label'
import type { FoodItem } from '../src/shared/types'

/** A FoodItem with only the fields foodLabel reads. */
function item(partial: Partial<FoodItem>): FoodItem {
  return {
    name: '',
    brand: null,
    barcode: null,
    servingDesc: null,
    unit: '100g',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    source: 'staple',
    ...partial
  }
}

describe('foodLabel — branded products', () => {
  it('keeps the product name verbatim and shows brand + serving as detail', () => {
    const label = foodLabel(
      item({
        name: 'Free Range Eggs Min 700g',
        brand: 'Green Eggs',
        servingDesc: 'per 100 g',
        source: 'search'
      })
    )
    expect(label.title).toBe('Free Range Eggs Min 700g')
    expect(label.detail).toBe('Green Eggs · per 100 g')
  })

  it('does not comma-split a branded name', () => {
    const label = foodLabel(
      item({ name: 'Eggs, Free Range', brand: 'Coles', source: 'search' })
    )
    expect(label.title).toBe('Eggs, Free Range')
  })
})

describe('foodLabel — generic foods', () => {
  it('promotes the head and demotes the remaining segments', () => {
    const label = foodLabel(item({ name: 'Kohlrabi, peeled', servingDesc: 'per 100 g' }))
    expect(label.title).toBe('Kohlrabi')
    expect(label.detail).toBe('peeled · per 100 g')
  })

  it('handles a name with no comma at all', () => {
    const label = foodLabel(item({ name: 'Textured vegetable protein/soy granules' }))
    expect(label.title).toBe('Textured vegetable protein/soy granules')
    expect(label.detail).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/food-label.test.ts`
Expected: FAIL — `Failed to resolve import "../src/shared/food-label"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/shared/food-label.ts`:

```ts
import type { FoodItem } from './types'

/** A search-result row's two lines: the bold title and the dimmed detail beneath it. */
export interface FoodLabel {
  /** What the food IS, in plain English. */
  title: string
  /** Everything the title didn't say, " · "-joined. May be empty. */
  detail: string
}

/** Sentence case: capitalise the first letter, leave the rest (AFCD has "pH", "UHT"). */
function sentenceCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

function join(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join(' · ')
}

/**
 * A readable label for one search result.
 *
 * Branded products already carry a marketing name written for humans, so it is used
 * verbatim. Generic foods come from the AFCD, which names a food as a taxonomy path
 * ("Egg, chicken, whole, hard-boiled") — a database key, not a label — so the head is
 * promoted to the title and everything else is demoted to the detail line.
 */
export function foodLabel(item: FoodItem): FoodLabel {
  if (item.brand) {
    return { title: item.name, detail: join([item.brand, item.servingDesc]) }
  }

  const segments = item.name
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const head = segments[0] ?? item.name
  const tail = segments.slice(1)

  return { title: sentenceCase(head), detail: join([...tail, item.servingDesc]) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/food-label.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/food-label.ts tests/food-label.test.ts
git commit -m "feat(food): promote the AFCD head to the result title"
```

---

### Task 2: The PREP lexicon — "Raw egg", "Hard-boiled egg"

**Files:**
- Modify: `src/shared/food-label.ts`
- Test: `tests/food-label.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/food-label.test.ts`:

```ts
describe('foodLabel — preparation', () => {
  it('fronts the preparation word', () => {
    expect(foodLabel(item({ name: 'Egg, chicken, whole, raw' })).title).toBe('Raw egg')
    expect(foodLabel(item({ name: 'Egg, chicken, whole, hard-boiled' })).title).toBe(
      'Hard-boiled egg'
    )
    expect(foodLabel(item({ name: 'Octopus, boiled, no added fat' })).title).toBe(
      'Boiled octopus'
    )
  })

  it('consumes the preparation segment so it is not repeated in the detail', () => {
    const label = foodLabel(item({ name: 'Egg, chicken, whole, raw' }))
    expect(label.title).toBe('Raw egg')
    expect(label.detail).toBe('chicken · whole')
  })

  it('takes only the first preparation word when a name carries two', () => {
    // "Peach, canned in pear juice, drained" — canned is the significant one.
    const label = foodLabel(item({ name: 'Peach, canned in pear juice, drained' }))
    expect(label.title).toBe('Canned peach')
    expect(label.detail).toBe('in pear juice · drained')
  })

  it('leaves a food with no preparation word alone', () => {
    expect(foodLabel(item({ name: 'Kohlrabi, peeled' })).title).toBe('Kohlrabi')
  })
})
```

Note the third case: `canned in pear juice` is matched by its leading word, and
the matched words are stripped from the segment — the remainder (`in pear
juice`) stays in the detail rather than being thrown away.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/food-label.test.ts`
Expected: FAIL — `expected 'Egg' to be 'Raw egg'`.

- [ ] **Step 3: Write the implementation**

In `src/shared/food-label.ts`, add above `foodLabel`:

```ts
/**
 * How the food was prepared. Fronted in the title ("Raw egg", "Hard-boiled egg") because
 * that is the difference the reader is choosing between — every AFCD food appears in
 * several of these forms and the raw name buried the distinction at the end of a
 * five-part string.
 *
 * Ordered longest-phrase-first so "deep fried" is matched before "fried" and
 * "hard-boiled" before "boiled".
 */
const PREP = [
  'deep fried',
  'stir-fried',
  'hard-boiled',
  'microwaved',
  'casseroled',
  'scrambled',
  'uncooked',
  'poached',
  'roasted',
  'steamed',
  'toasted',
  'grilled',
  'smoked',
  'boiled',
  'canned',
  'dried',
  'fried',
  'fresh',
  'baked',
  'raw'
]

/** Match `phrase` at the start of `segment`, returning what's left of the segment. */
function matchLeading(segment: string, phrase: string): string | null {
  const s = segment.toLowerCase()
  if (s === phrase) return ''
  if (s.startsWith(`${phrase} `)) return segment.slice(phrase.length + 1).trim()
  return null
}

interface Pick {
  /** The lexicon word that was matched, for the title. */
  word: string
  /** Index of the segment it came from. */
  index: number
  /** What remained of that segment, for the detail. '' when fully consumed. */
  rest: string
}

/** First segment whose leading words are in `lexicon`, or null. */
function pickFrom(tail: string[], lexicon: string[], taken: Set<number>): Pick | null {
  for (let i = 0; i < tail.length; i++) {
    if (taken.has(i)) continue
    for (const word of lexicon) {
      const rest = matchLeading(tail[i], word)
      if (rest !== null) return { word, index: i, rest }
    }
  }
  return null
}
```

Replace the body of `foodLabel` after the `tail` assignment with:

```ts
  const taken = new Set<number>()
  const prep = pickFrom(tail, PREP, taken)
  if (prep) taken.add(prep.index)

  const title = [prep?.word, head.toLowerCase()].filter(Boolean).join(' ')

  const rest = tail.flatMap((seg, i) => {
    if (!taken.has(i)) return [seg]
    const leftover = i === prep?.index ? prep.rest : ''
    return leftover ? [leftover] : []
  })

  return { title: sentenceCase(title), detail: join([...rest, item.servingDesc]) }
```

Note what is deliberately absent from `PREP`: `no added fat`, `commercial`,
`homemade`, `as purchased`. They describe the sourcing, not the food, and belong
on the detail line.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/food-label.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/food-label.ts tests/food-label.test.ts
git commit -m "feat(food): front the preparation word in result titles"
```

---

### Task 3: PREFIX_MODIFIER and PART — "Fried red capsicum", "Raw egg yolk"

**Files:**
- Modify: `src/shared/food-label.ts`
- Test: `tests/food-label.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/food-label.test.ts`:

```ts
describe('foodLabel — modifiers and parts', () => {
  it('places a colour or grade modifier before the head', () => {
    expect(foodLabel(item({ name: 'Wine, white, riesling' })).title).toBe('White wine')
    expect(
      foodLabel(item({ name: 'Capsicum, red, fresh, fried, no added fat' })).title
    ).toBe('Fried red capsicum')
  })

  it('places a body part after the head', () => {
    expect(foodLabel(item({ name: 'Egg, chicken, yolk, raw' })).title).toBe('Raw egg yolk')
    expect(
      foodLabel(item({ name: 'Chicken, thigh, lean flesh, skin & fat, baked, no added fat' }))
        .title
    ).toBe('Baked chicken thigh')
  })

  it('keeps every unconsumed segment in the detail', () => {
    const label = foodLabel(
      item({ name: 'Chicken, thigh, lean flesh, skin & fat, baked, no added fat' })
    )
    expect(label.detail).toBe('lean flesh · skin & fat · no added fat')
  })

  it('takes at most one word per lexicon', () => {
    // "white" is both a modifier and (as albumen) a part; it must not fill both slots.
    const label = foodLabel(item({ name: 'Egg, chicken, white (albumen), raw' }))
    expect(label.title).toBe('Raw egg white')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/food-label.test.ts`
Expected: FAIL — `expected 'Wine' to be 'White wine'`.

- [ ] **Step 3: Write the implementation**

Add the two lexicons beneath `PREP` in `src/shared/food-label.ts`:

```ts
/**
 * Qualifiers English puts BEFORE the noun. "Capsicum, red" is a red capsicum, never a
 * "capsicum red" — placing these after the head produces titles that read as typos.
 */
const PREFIX_MODIFIER = [
  'regular fat',
  'reduced fat',
  'wholemeal',
  'savoury',
  'brown',
  'green',
  'plain',
  'sweet',
  'white',
  'red'
]

/**
 * Which part of the animal or plant. These follow the head ("egg yolk", "chicken
 * thigh") and matter enormously to the macros — the yolk is 313 kcal/100 g against the
 * white's 47 — so they belong in the title, not the detail line.
 *
 * "white" appears here and in PREFIX_MODIFIER; the one-pick-per-lexicon rule plus the
 * order of the picks below means the egg white is a part, and white wine a modifier.
 */
const PART = [
  'yolk',
  'white (albumen)',
  'albumen',
  'fillet',
  'breast',
  'thigh',
  'mince',
  'chips',
  'flesh',
  'steak',
  'leg',
  'skin',
  'seed'
]
```

Extend the pick sequence in `foodLabel` — `part` is picked BEFORE `modifier` so
"white (albumen)" is claimed as a part while "Wine, white" still reaches the
modifier lexicon:

```ts
  const taken = new Set<number>()
  const prep = pickFrom(tail, PREP, taken)
  if (prep) taken.add(prep.index)
  const part = pickFrom(tail, PART, taken)
  if (part) taken.add(part.index)
  const modifier = pickFrom(tail, PREFIX_MODIFIER, taken)
  if (modifier) taken.add(modifier.index)

  const title = [prep?.word, modifier?.word, head.toLowerCase(), part?.word]
    .filter(Boolean)
    .join(' ')
```

and widen the leftover collection to all three picks:

```ts
  const leftovers = new Map<number, string>()
  for (const p of [prep, part, modifier]) if (p) leftovers.set(p.index, p.rest)

  const rest = tail.flatMap((seg, i) => {
    if (!taken.has(i)) return [seg]
    const leftover = leftovers.get(i) ?? ''
    return leftover ? [leftover] : []
  })
```

`PART` matching is leading-word based, so `white (albumen)` matches on the full
phrase and yields the word `white (albumen)`. Normalise it in the title by
mapping that one entry:

```ts
/** AFCD writes the egg white as "white (albumen)"; the parenthetical is for scientists. */
const PART_TITLE: Record<string, string> = { 'white (albumen)': 'white', albumen: 'white' }
```

and use `PART_TITLE[part.word] ?? part.word` when assembling the title.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/food-label.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/food-label.ts tests/food-label.test.ts
git commit -m "feat(food): order modifiers before and parts after the head"
```

---

### Task 4: The category-head rule — "Raw peanut", not "Raw nut"

**Files:**
- Modify: `src/shared/food-label.ts`
- Test: `tests/food-label.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/food-label.test.ts`:

```ts
describe('foodLabel — category heads', () => {
  it('replaces a bare category head with its specific segment', () => {
    expect(foodLabel(item({ name: 'Nut, peanut, with skin, raw, unsalted' })).title).toBe(
      'Raw peanut'
    )
    expect(foodLabel(item({ name: 'Fish, eel, raw' })).title).toBe('Raw eel')
    expect(foodLabel(item({ name: 'Cheese, edam' })).title).toBe('Edam')
  })

  it('does not consume a multi-word segment as the head', () => {
    // "white wheat flour & egg" describes the pasta; it is not a name for it.
    const label = foodLabel(item({ name: 'Pasta, white wheat flour & egg, dry' }))
    expect(label.title).toBe('Pasta')
    expect(label.detail).toBe('white wheat flour & egg · dry')
  })

  it('does not treat a non-category head as replaceable', () => {
    // "chicken" must not become the title of an egg.
    expect(foodLabel(item({ name: 'Egg, chicken, whole, raw' })).title).toBe('Raw egg')
  })

  it('leaves a head that is not in the category list alone', () => {
    // `oil` is deliberately NOT a category head: "Olive oil" would need the segment
    // placed BEFORE the head, which is the modifier lexicon's job, not this rule's.
    const label = foodLabel(item({ name: 'Oil, olive' }))
    expect(label.title).toBe('Oil')
    expect(label.detail).toBe('olive')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/food-label.test.ts`
Expected: FAIL — `expected 'Raw nut' to be 'Raw peanut'`.

- [ ] **Step 3: Write the implementation**

Add to `src/shared/food-label.ts`:

```ts
/**
 * Heads that name a CATEGORY rather than a food. The AFCD files the specific food as the
 * next segment ("Nut, peanut", "Fish, eel", "Cheese, edam"), so promoting the head alone
 * produces a title that answers the wrong question — every nut in the database would be
 * called "nut". The replacement only fires for a single-word segment: "Pasta, white wheat
 * flour & egg" describes the pasta, it isn't a name for it.
 */
const CATEGORY_HEAD = new Set([
  'nut',
  'fish',
  'bread',
  'cheese',
  'sauce',
  'biscuit',
  'bar',
  'noodle',
  'seed',
  'herb',
  'spice'
])
```

and, immediately after `taken`/pick assembly but before the title is built:

```ts
  let effectiveHead = head
  if (CATEGORY_HEAD.has(head.toLowerCase())) {
    const i = tail.findIndex((seg, idx) => !taken.has(idx) && !seg.includes(' '))
    if (i !== -1) {
      effectiveHead = tail[i]
      taken.add(i)
      leftovers.set(i, '')
    }
  }
```

then use `effectiveHead.toLowerCase()` in the title assembly. Move the
`leftovers` map construction above this block so the `leftovers.set` call is
valid.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/food-label.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/food-label.ts tests/food-label.test.ts
git commit -m "feat(food): name the food, not its AFCD category"
```

---

### Task 5: The 40-character cap and the corpus invariant

The safety net. Once this passes, the lexicons can be tuned without fear.

**Files:**
- Modify: `src/shared/food-label.ts`
- Test: `tests/food-label.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/food-label.test.ts`:

```ts
import auFoods from '../src/shared/data/au-foods.json'

describe('foodLabel — title cap', () => {
  it('drops the part, then the modifier, to stay within 40 characters', () => {
    const label = foodLabel(
      item({ name: 'Breakfast cereal biscuit, wholemeal wheat, regular fat, toasted' })
    )
    expect(label.title.length).toBeLessThanOrEqual(40)
  })
})

describe('foodLabel — corpus invariant over the whole AFCD', () => {
  const foods = auFoods as { name: string }[]

  it('covers every bundled food', () => {
    expect(foods.length).toBeGreaterThan(1500)
  })

  it('always produces a non-empty title of at most 40 characters', () => {
    for (const f of foods) {
      const { title } = foodLabel(item({ name: f.name }))
      expect(title.length, f.name).toBeGreaterThan(0)
      expect(title.length, f.name).toBeLessThanOrEqual(40)
    }
  })

  it('never discards a segment — each appears in the title or the detail', () => {
    for (const f of foods) {
      const { title, detail } = foodLabel(item({ name: f.name }))
      const shown = `${title} ${detail}`.toLowerCase()
      for (const segment of f.name.split(',').map((s) => s.trim().toLowerCase())) {
        if (!segment) continue
        // A segment may be split between the two lines (a lexicon word in the title,
        // its remainder in the detail), so check the words rather than the phrase.
        for (const word of segment.split(/[^a-z0-9]+/).filter(Boolean)) {
          expect(shown, `${f.name} — lost "${word}"`).toContain(word)
        }
      }
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/food-label.test.ts`
Expected: FAIL — at least the cap assertion, on a long AFCD head.

- [ ] **Step 3: Write the implementation**

Replace the title assembly in `foodLabel` with a capped build:

```ts
/** Longest title we let into a 52 px row before it wraps and breaks the list rhythm. */
const MAX_TITLE = 40

/**
 * Assemble the title, dropping the least important slot first when it doesn't fit. Part
 * goes before modifier: a "thigh" is easier to lose than a "wholemeal", and the detail
 * line catches whatever is dropped.
 */
function buildTitle(
  prep: string | undefined,
  modifier: string | undefined,
  head: string,
  part: string | undefined
): string {
  const candidates = [
    [prep, modifier, head, part],
    [prep, modifier, head],
    [prep, head],
    [head]
  ]
  for (const parts of candidates) {
    const t = parts.filter(Boolean).join(' ')
    if (t.length <= MAX_TITLE) return t
  }
  return head.slice(0, MAX_TITLE).trim()
}
```

Call it with the picked words, and — because a dropped slot must not vanish —
compute the detail from the words actually used:

```ts
  const partWord = part ? (PART_TITLE[part.word] ?? part.word) : undefined
  const title = buildTitle(prep?.word, modifier?.word, effectiveHead.toLowerCase(), partWord)

  // A slot the cap dropped is not in the title, so it goes back to the detail line.
  for (const p of [prep, part, modifier]) {
    if (p && !title.toLowerCase().includes(p.word.toLowerCase())) leftovers.set(p.index, tail[p.index])
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/food-label.test.ts`
Expected: PASS, 20 tests. If the corpus invariant reports a lost word, the fix
is in the lexicons or the leftover handling — never in weakening the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/shared/food-label.ts tests/food-label.test.ts
git commit -m "test(food): assert no AFCD segment is ever discarded"
```

---

### Task 6: Kilojoule fallback in `mapOffProduct`

**Files:**
- Modify: `src/shared/nutrition.ts:560-612`
- Test: `tests/nutrition.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the `mapOffProduct` describe block in `tests/nutrition.test.ts`:

```ts
  it('derives kcal from kilojoules when OpenFoodFacts has no kcal field', () => {
    // Australian labels are kJ-first and OFF stores what the label says. Six of the
    // eighteen branded results for "eggs" carry only energy-kj_100g.
    const product = {
      product_name: 'Eggs',
      brands: 'McLaren Vale Free Range Eggs',
      code: '9315748109986',
      nutriments: {
        'energy-kj_100g': 559,
        proteins_100g: 12.2,
        carbohydrates_100g: 1.3,
        fat_100g: 9.9
      }
    }
    const item = mapOffProduct(product, 'search')
    expect(item).not.toBeNull()
    expect(item!.calories).toBe(134) // 559 / 4.184 = 133.6
    expect(item!.per100g!.calories).toBe(134)
  })

  it('prefers the label kcal figure when both units are present', () => {
    const product = {
      product_name: 'Bread',
      brands: 'Tip Top',
      code: '9300601000012',
      nutriments: {
        'energy-kcal_100g': 260,
        'energy-kj_100g': 1200,
        proteins_100g: 9,
        carbohydrates_100g: 45,
        fat_100g: 3
      }
    }
    expect(mapOffProduct(product, 'search')!.calories).toBe(260)
  })

  it('still drops a product with no nutriment data at all', () => {
    const product = {
      product_name: 'Farm Fresh Eggs',
      brands: 'Farmhouse Fresh',
      code: '9310229800185',
      nutriments: {}
    }
    expect(mapOffProduct(product, 'search')).toBeNull()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/nutrition.test.ts`
Expected: FAIL — `expected 0 to be 134`.

- [ ] **Step 3: Write the implementation**

In `src/shared/nutrition.ts`, add the kJ keys to the `OffProduct` nutriments
interface beside the existing kcal keys (around `:562` and `:566`):

```ts
  'energy-kj_100g'?: number | string
  'energy-kj_serving'?: number | string
```

Add the conversion helper above `mapOffProduct`:

```ts
/** Thermochemical kilojoules per kilocalorie — the factor FSANZ and EU labelling use. */
const KJ_PER_KCAL = 4.184

/** kcal from whichever unit OpenFoodFacts holds. AU labels are kJ-first and OFF stores
 *  what the label says, so a kcal-only reader scored those products at zero. */
function kcalFrom(kcal: unknown, kj: unknown): number | null {
  const direct = num(kcal)
  if (direct !== null) return direct
  const asKj = num(kj)
  return asKj === null ? null : asKj / KJ_PER_KCAL
}
```

Replace the two reads at `:601` and `:606`:

```ts
  const cal100 = kcalFrom(n['energy-kcal_100g'], n['energy-kj_100g'])
  ...
  const servingCal = kcalFrom(n['energy-kcal_serving'], n['energy-kj_serving'])
```

No change is needed to the null-guard below them: it already tests `cal100`,
which now sees kJ-only products.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/nutrition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/nutrition.ts tests/nutrition.test.ts
git commit -m "fix(food): read kilojoules when a product has no kcal figure"
```

---

### Task 7: Render the labels in `AddFoodModal`

**Files:**
- Modify: `src/renderer/components/AddFoodModal.tsx:21-70`
- Modify: `src/renderer/styles.css:1040`

- [ ] **Step 1: Wire `FoodRow` to `foodLabel`**

In `src/renderer/components/AddFoodModal.tsx`, add the import:

```ts
import { foodLabel } from '../../shared/food-label'
```

Delete `foodSub` (lines 21-23) and rewrite `FoodRow`:

```tsx
/** One tappable food row: readable title + demoted detail, kcal right-aligned. */
function FoodRow(props: { item: FoodItem; onPick: () => void; note?: string }): JSX.Element {
  const label = foodLabel(props.item)
  return (
    <button className="food-row" onClick={props.onPick}>
      <span className="food-row__main">
        <span className="food-row__name">{label.title}</span>
        <span className="food-row__sub">{props.note ?? label.detail}</span>
      </span>
      <span className="food-row__kcal">
        {Math.round(props.item.calories)}
        <span className="food-row__basis">{kcalBasis(props.item)}</span>
      </span>
    </button>
  )
}
```

The planned-food row at `:611-621` builds its markup inline; update its name
span to use the label too:

```tsx
<span className="food-row__name">Planned: {foodLabel(props.planned).title}</span>
```

- [ ] **Step 2: Truncate the detail line to one line**

In `src/renderer/styles.css`, extend `.food-row__sub` (`:1040`):

```css
.food-row__sub {
  font-size: 11.5px;
  color: var(--muted-2);
  /* The detail line carries every AFCD segment the title didn't use, so it can run long.
     One line, clipped — the full food is identified by the title above it. */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck:web`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/AddFoodModal.tsx src/renderer/styles.css
git commit -m "feat(food): render readable labels in the Add Food rows"
```

---

### Task 8: Split the results into labelled blocks with a capped generic list

**Files:**
- Modify: `src/renderer/components/AddFoodModal.tsx:630-660`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Add the cap state**

Beside the existing `results` state (`:347`), add:

```tsx
  // Generic AFCD hits are capped so the branded block stays reachable without scrolling
  // ("eggs" returns 17 generics). Reset whenever the query changes.
  const [showAllBasic, setShowAllBasic] = useState(false)
```

In the query-change handler `onQueryChange`, add `setShowAllBasic(false)`
alongside the existing result reset.

- [ ] **Step 2: Partition and render**

Above the `return`, derive the two blocks:

```tsx
  const BASIC_CAP = 6
  const basic = results.filter((r) => r.source === 'staple')
  const packaged = results.filter((r) => r.source !== 'staple')
  const basicShown = showAllBasic ? basic : basic.slice(0, BASIC_CAP)
```

Replace the results block (the `<div className="addfood__head eyebrow">Results</div>`
and its `results.map`) with:

```tsx
                  {basic.length > 0 && (
                    <>
                      <div className="addfood__head eyebrow">Basic foods</div>
                      {basicShown.map((item) => (
                        <FoodRow key={foodKey(item)} item={item} onPick={() => pick(item)} />
                      ))}
                      {basic.length > BASIC_CAP && !showAllBasic && (
                        <button className="addfood__more" onClick={() => setShowAllBasic(true)}>
                          Show {basic.length - BASIC_CAP} more
                        </button>
                      )}
                    </>
                  )}
                  {packaged.length > 0 && (
                    <>
                      <div className="addfood__head eyebrow">Packaged products</div>
                      {packaged.map((item) => (
                        <FoodRow key={foodKey(item)} item={item} onPick={() => pick(item)} />
                      ))}
                    </>
                  )}
```

The surrounding `{query.trim() !== '' && (…)}` guard and every note/banner below
it stay exactly as they are.

- [ ] **Step 3: Style the expander**

Append to `src/renderer/styles.css` after `.addfood__link`:

```css
/* Expander for the capped generic block — a full-width tap strip, not a hairline link. */
.addfood__more {
  width: 100%;
  min-height: 44px;
  padding: 10px 0;
  border: none;
  border-bottom: 1px solid var(--divider);
  background: none;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--muted);
  text-align: left;
  cursor: pointer;
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck:web && npx vitest run && npm run lint`
Expected: typecheck clean, all tests pass, lint reports 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/AddFoodModal.tsx src/renderer/styles.css
git commit -m "feat(food): split results into basic and packaged blocks"
```

---

### Task 9: Verify against the live search

**Files:** none — verification only.

- [ ] **Step 1: Re-run the "eggs" probe end to end**

Write `probe.mts` in the project root:

```ts
import { searchStaples, mapOffProduct } from './src/shared/nutrition'
import { foodLabel } from './src/shared/food-label'
import type { FoodItem } from './src/shared/types'
import { readFileSync } from 'node:fs'

const off = (JSON.parse(readFileSync('probe-off.json', 'utf8')).products ?? [])
  .map((p: never) => mapOffProduct(p, 'search'))
  .filter((x: FoodItem | null): x is FoodItem => x !== null)

for (const f of [...searchStaples('eggs'), ...off]) {
  const l = foodLabel(f)
  console.log(`${l.title.padEnd(34)} ${String(Math.round(f.calories)).padStart(4)}  ${l.detail}`)
}
```

Fetch the branded fixture first:

```bash
curl -s "https://recipevault-kappa.vercel.app/api/food-search?q=eggs" -o probe-off.json
npx vite-node probe.mts
```

Expected: generic titles read "Raw egg", "Poached egg", "Hard-boiled egg",
"Fried egg", "Scrambled egg", "Raw eggplant"; **no branded row shows 0 kcal**
(the six kJ-only products now report ~134-142).

- [ ] **Step 2: Clean up**

```bash
rm probe.mts probe-off.json
```

- [ ] **Step 3: Full green check**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: all clean. Note `npm run lint`'s summary line is authoritative — the
"potentially fixable" tail is not an error count.

---

## Done when

- `npx vitest run` passes, including the corpus invariant over all 1,588 names.
- `npm run typecheck` and `npm run lint` are clean.
- Searching "eggs" shows a **Basic foods** block of six readable titles with a
  "Show 11 more" expander, then a **Packaged products** block, and no row
  reports 0 kcal.
