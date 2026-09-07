# Readable Food Search Results — Design

**Date:** 2026-09-07
**Status:** Approved (Harrison: "this looks good, please go ahead with the build").

## Problem (Harrison's report)

Searching "eggs" in the Add Food modal returns 35 rows and it isn't clear what
any single one of them is:

```
Egg, chicken, whole, raw                                    127 /100g
Egg, chicken, whole, omega-3 polyunsaturate enriched, raw    133 /100g
Egg, chicken, whole, scrambled, with regular fat cow's       120 /100g
  milk, no fat added
Eggs · McLaren Vale Free Range Eggs                            0 /100g
```

> "to me it is a bit confusing as to what I am looking at. It would be nice if
> this could be cleaned up, and for it to be made clear that this option is just
> an egg, or just a boiled egg, etc. And I guess this also applies to
> everything."

Three separate causes, all visible in that one screen:

1. **Generic rows print raw AFCD taxonomy strings.** The Australian Food
   Composition Database names a food as `head, qualifier, qualifier, …`
   ("Egg, chicken, whole, hard-boiled"). That's a database key, not a label.
2. **Nothing separates the two result blocks.** Generic AFCD foods (per 100 g)
   and branded OpenFoodFacts products (per serve) sit in one flat list, so the
   kcal basis silently changes partway down.
3. **The generic block is long and repetitive.** "eggs" yields 17 generic rows —
   omega-3 variants, yolk, white, egg pasta — pushing branded results off screen.

A fourth defect surfaced while investigating and is fixed here because it is in
the same rows: **six of the eighteen branded egg results display `0 kcal`.**

## Findings

### AFCD name structure (all 1,588 bundled rows)

| Commas per name | 0 | 1 | 2 | 3 | 4 | 5 | 6+ |
|---|---|---|---|---|---|---|---|
| Rows | 16 | 216 | 434 | 489 | 282 | 108 | 43 |

931 distinct tail segments, but the distribution is steeply headed — a small
vocabulary covers most rows:

```
412 raw          96 baked        42 dried        28 casseroled
279 no added fat 89 boiled       39 uncooked     28 roasted
144 fresh        62 fillet       39 lean flesh   25 homemade
127 peeled       61 fried        36 steak        24 steamed
101 drained      45 grilled      33 white        21 toasted
 99 lean         33 unpeeled     30 sweet        21 whole
```

That regularity is what makes a rule-based rewrite viable rather than guesswork:
roughly 40 words classify the segments that belong in a title, and everything
else can be demoted without being understood.

### The `0 kcal` branded rows

Australian nutrition labels are kilojoule-first, and OpenFoodFacts stores what
the label says without back-filling the other unit. Six of the eighteen mapped
egg products carry `energy-kj_100g` and no `energy-kcal_100g`:

| Product | OFF nutriments |
|---|---|
| Eggs · McLaren Vale | `energy-kj_100g: 559`, no kcal |
| 12 Extra Large Eggs · GOLDEN EGGS | `energy-kj_100g: 596`, no kcal |
| Eggs · Liberty Eggs | `energy-kj_100g: 596`, no kcal |
| McLaren Vale Free Range Eggs | `energy-kj_100g: 559`, no kcal |
| Nougat Easter Egg · Darrell Lea | `energy-kj_100g: 1770`, no kcal |
| Extra large cage eggs · Sunrise | no energy field at all |

`mapOffProduct` (`src/shared/nutrition.ts:601`, `:606`) reads only the `kcal`
keys. Protein/carbs/fat are present, so the null-guard at `:610` passes, the
item survives, and calories fall through to `?? 0`. Logging a McLaren Vale egg
records correct macros against **zero calories**. This hits AU-specific products
hardest — precisely the ones the AU-filtered search is built to surface.

## Design

### 1. `src/shared/food-label.ts` (new)

One pure function, no React and no network, so it is directly unit-testable and
the recipe estimator can borrow it later:

```ts
export interface FoodLabel { title: string; detail: string }
export function foodLabel(item: FoodItem): FoodLabel
```

**Branded items** (anything with a `brand` or without AFCD comma structure) keep
their product name verbatim as the title; `detail` stays `brand · servingDesc`,
exactly today's `foodSub`. Only the header above them changes.

**Generic AFCD items** are split on commas into `head` plus tail segments. Each
tail segment is classified against four lexicons and the title is assembled in
one fixed English order:

```
title  =  [prep] [prefix-modifier] head [part]
detail =  every segment not consumed by the title, joined by " · "
```

| Lexicon | Members | Placement |
|---|---|---|
| PREP | raw, fresh, boiled, hard-boiled, baked, fried, deep fried, grilled, roasted, steamed, poached, scrambled, casseroled, stir-fried, toasted, dried, canned, smoked, microwaved, uncooked | front of title |
| PREFIX_MODIFIER | white, red, green, brown, wholemeal, plain, sweet, savoury, regular fat, reduced fat | before head |
| PART | yolk, white (albumen), fillet, breast, thigh, leg, flesh, skin, seed, chips, mince | after head |
| — everything else | the ~900 long-tail segments | detail line only |

At most one segment is taken per lexicon — the first match in AFCD order, which
is the most significant one. Result:

| AFCD name | Title | Detail |
|---|---|---|
| Egg, chicken, whole, raw | Raw egg | chicken · whole |
| Egg, chicken, whole, hard-boiled | Hard-boiled egg | chicken · whole |
| Egg, chicken, yolk, raw | Raw egg yolk | chicken |
| Chicken, thigh, lean flesh, skin & fat, baked, no added fat | Baked chicken thigh | lean flesh · skin & fat · no added fat |
| Capsicum, red, fresh, fried, no added fat | Fried red capsicum | fresh · no added fat |
| Wine, white, riesling | White wine | riesling |

**Category-head rule.** When the head is a bare category noun (`nut`, `fish`,
`bread`, `cheese`, `sauce`, `biscuit`, `bar`, `noodle`, `seed`, `herb`, `spice`) and
segment 1 is a single word, segment 1 *replaces* the head:
`Nut, peanut, with skin, raw` → **Raw peanut** (not "Raw nut"),
`Fish, eel, raw` → **Raw eel**, `Cheese, edam` → **Edam**. Without this the
title names a category rather than the food, which is the exact complaint.

**Nothing is ever discarded.** Unknown segments and noise phrases
("no added fat", "commercial", "as purchased") are not dropped — they simply
never qualify for the title and fall to the detail line, which CSS truncates to
one line. This keeps a total invariant that tests can assert against, so a
future lexicon edit cannot silently start eating data.

Titles are sentence-cased and capped at 40 characters; a longer assembly drops
the `[part]` slot first, then the `[prefix-modifier]`.

### 2. `AddFoodModal` — grouped, capped results

`FoodRow` renders `foodLabel(item)` instead of `item.name` / `foodSub(item)`.
Results are partitioned by `item.source`:

```
┌ Basic foods ───────────────────────┐   item.source === 'staple'
   Raw egg                                capped at 6 rows,
     chicken · whole · per 100 g   127     then "Show N more"
   Hard-boiled egg
     chicken · whole · per 100 g   136
   ⌄ Show 11 more

┌ Packaged products ─────────────────┐   everything else
   Free range eggs
     Coles · per 100 g             142     uncapped
```

Headers reuse the existing `.addfood__head eyebrow` treatment already used for
"Recents" and "Results", so this adds no new visual vocabulary. The cap resets
whenever the query changes. A block with no rows renders no header. The Recents
and Planned blocks are untouched apart from picking up the new labels.

### 3. `mapOffProduct` — kilojoule fallback

`OffProduct` gains `'energy-kj_100g'` and `'energy-kj_serving'`. Where the kcal
field is absent, kcal is derived as `kJ / 4.184` (the thermochemical factor the
FSANZ and EU labelling standards use) and rounded. The kcal field still wins
when both are present — the label's own kcal figure is authoritative. The
existing null-guard extends to the kJ keys so a product carrying only kJ is no
longer treated as having no energy data.

### 4. Explicitly not doing

- No change to search ranking, `searchStaples`, or the merge in `searchFoods` —
  the ordering is already correct, only its presentation was unreadable.
- No rewrite of the bundled `au-foods.json`. Labels are derived at render time,
  so the lexicons can be tuned without a data rebuild.
- No collapsing of variants under a shared parent row (considered; rejected as
  it adds a second tap to reach a food that is currently one tap away).
- No change to what gets logged. `foodLabel` is display-only; `food_log` keeps
  storing `item.name`, so existing rows, recents dedupe and the barcode cache
  are all unaffected.

## Testing

- `tests/food-label.test.ts`
  - one case per lexicon class, plus prep + modifier + part combined;
  - the category-head rule, including the negative case (multi-word segment 1
    must not replace the head);
  - branded passthrough;
  - the 40-character cap and its drop order.
- **Corpus invariant over all 1,588 AFCD names**: every name yields a non-empty
  title of at most 40 characters, and every comma segment of the source name
  appears in either the title or the detail. This is the guard that makes the
  lexicons safe to edit.
- `tests/nutrition.test.ts` — kJ-only product yields the right kcal; kcal wins
  when both units are present; a product with neither is still dropped.
- Post-build check: search "eggs" and confirm the six `0 kcal` rows now carry
  real figures.

## Deploy

No schema change, no new env var. Merge to `main` and push; Vercel redeploys.
