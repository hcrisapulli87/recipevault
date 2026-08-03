import type { FoodItem, FoodMeasure, Per100g } from './types'
import auFoodsData from './data/au-foods.json'

// Generic (non-branded) foods come from the FSANZ Australian Food Composition
// Database (AFCD Release 3.0, CC BY) — bundled offline as au-foods.json, built
// by scripts/build-au-foods.mjs. Each record's macros are per 100 g; `measures`
// (when present) are real AU household serving sizes.
interface AuFood {
  key: string
  name: string
  calories: number
  protein: number
  carbs: number
  fat: number
  measures?: FoodMeasure[]
}

const AU_FOODS = auFoodsData as AuFood[]

const round0 = (n: number): number => Math.round(n)
const round1 = (n: number): number => Math.round(n * 10) / 10

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Crude depluraliser applied to BOTH sides of a match, so consistency matters
// more than English correctness ("thighs"→"thigh"; "couscous"→"couscou" on both sides).
function normFood(s: string): string {
  return s.toLowerCase().replace(/(\w{3,}?)s\b/g, '$1')
}

/** The comma-prefix "head" of an AFCD name — "Pasta, white wheat flour, boiled" → "pasta". */
function headOf(name: string): string {
  return name.toLowerCase().split(',')[0].trim()
}

function auToFoodItem(f: AuFood): FoodItem {
  const per100g: Per100g = {
    calories: f.calories,
    protein: f.protein,
    carbs: f.carbs,
    fat: f.fat
  }
  return {
    name: f.name,
    brand: null,
    barcode: null,
    servingDesc: 'per 100 g',
    unit: '100g',
    calories: f.calories,
    protein: f.protein,
    carbs: f.carbs,
    fat: f.fat,
    source: 'staple',
    per100g,
    measures: f.measures ?? []
  }
}

/**
 * Relevance rank of an AFCD food for a query (lower = better). Generic whole
 * foods should beat verbose composite names: an exact/prefix hit on the head
 * name ("Pasta, …" for "pasta") ranks far above a deep substring match
 * ("…with pasta…"). Ties break on the shorter (usually more generic) name.
 */
function rankScore(nameLower: string, head: string, headN: string, q: string, qn: string): number {
  if (head === q) return 0
  if (headN === qn) return 1
  if (head.startsWith(q)) return 2
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(nameLower)) return 3
  if (head.includes(q)) return 4
  return 5 // substring somewhere in the tail
}

/**
 * Relevance-ranked search over the bundled AU generic-food database. Returns
 * enriched FoodItems (per-100 g basis + real serving measures). This is the
 * generic layer that ranks ABOVE branded OpenFoodFacts hits in the Add flow.
 */
export function searchStaples(query: string): FoodItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const qn = normFood(q)
  // Match on ALL query words, not the exact phrase: "chicken breast" must find
  // "Chicken, breast, baked" (AFCD puts a comma between them). The phrase is still
  // used for head-name ranking below, so an exact "Pasta, …" hit still wins.
  const tokens = q.split(/\s+/).filter(Boolean)

  const scored: { f: AuFood; score: number }[] = []
  for (const f of AU_FOODS) {
    const nameLower = f.name.toLowerCase()
    if (!tokens.every((t) => nameLower.includes(t))) continue
    const head = headOf(f.name)
    scored.push({ f, score: rankScore(nameLower, head, normFood(head), q, qn) })
  }
  // Same relevance → prefer foods with real serving sizes (these are the curated
  // everyday forms — cooked rice/pasta, raw banana, fluid milk — so they beat
  // odd forms like "dry"/"powder"/"frozen"), then the shorter/more generic name.
  const hasMeasures = (f: AuFood): number => (f.measures && f.measures.length ? 0 : 1)
  scored.sort(
    (a, b) =>
      a.score - b.score || hasMeasures(a.f) - hasMeasures(b.f) || a.f.name.length - b.f.name.length
  )
  return scored.slice(0, 25).map((s) => auToFoodItem(s.f))
}

// ── recipe macro estimator: generic-food lookup ───────────────────────────────
//
// This used to take every AFCD food whose head name was a substring of the ingredient
// (or vice versa) and keep the SHORTEST name. Substring matching crosses word
// boundaries, so "rice" matched Liquorice and "coconut milk" matched almond meal
// ("nut" ⊂ "coconut"); and "shortest name" preferred the processed form, so plain
// "tomatoes" resolved to sundried tomato at 263 kcal/100 g. Every estimate built on
// those matches was quietly wrong. Matching is now word-based and ranked.

/** Singularise one word. Applied to BOTH sides, so it only has to be consistent —
 *  "couscous" → "couscou" everywhere is harmless. */
function singular(w: string): string {
  if (w.length > 3 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.length > 4 && /(oes|ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

function wordsOf(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular)
}

/**
 * Forms that move calories a long way from the plain ingredient. Each is penalised only
 * when the ingredient didn't ask for it, so "tomatoes" gets the fresh one while
 * "canned tomatoes" and "sundried tomatoes" still resolve to theirs.
 *
 * The cooked forms matter as much as the processed ones: an ingredient line is what goes
 * INTO the pot, so "250 g spaghetti" and "1 cup rice" are dry weights. Matching them to
 * boiled pasta (137 kcal/100 g) instead of dry (348) more than halves the estimate.
 * `raw`, `fresh`, `dry` and `uncooked` are deliberately absent — those are what we want.
 */
const PROCESSED_MARKERS = [
  // preserved / transformed
  'dried',
  'sundried',
  'dehydrated',
  'powder',
  'powdered',
  'chip',
  'crisp',
  'candied',
  'glace',
  'concentrate',
  'extract',
  'beverage',
  'smoked',
  'canned',
  'pickled',
  'preserved',
  'imitation',
  'substitute',
  'syrup',
  'flavoured',
  'sweetened',
  'infant',
  'toddler',
  // cooked: recipes measure ingredients before cooking
  'boiled',
  'cooked',
  'baked',
  'roasted',
  'grilled',
  'fried',
  'steamed',
  'poached',
  'scrambled',
  'microwaved',
  'braised',
  'stewed',
  'casseroled',
  'toasted',
  'barbecued',
  // parts, not the whole ingredient ("eggs" must not mean egg yolk)
  'yolk',
  'albumen',
  'peel',
  'rind',
  'skin',
  'bone',
  'stalk',
  // lean/light variants: for a best-guess estimate, over- beats under-counting
  'skim',
  'reduced',
  'lower',
  'low',
  'light',
  'lite',
  'diet'
].map(singular)

/**
 * The AFCD's vocabulary for "the ordinary one". Rewarded so that an unqualified
 * ingredient lands on the neutral default: "eggs" → whole egg rather than yolk,
 * "milk"/"beef mince" → regular fat rather than a lean variant, "tomatoes" → common.
 */
// 'fresh' is deliberately NOT here: it's the neutral word for produce but the opposite of
// neutral for pantry staples, where it means fresh pasta (268 kcal/100 g) rather than the
// dry packet (348) a recipe's "250 g spaghetti" actually refers to.
const DEFAULT_MARKERS = ['regular', 'common', 'plain', 'whole', 'natural'].map(singular)

/**
 * Words that describe a food but never name one. The backoff below shortens an unmatched
 * ingredient one word at a time, and without this guard it will happily match on whatever
 * qualifier survives: "frozen edamame" (the AFCD has no edamame) fell through to the bare
 * word "frozen" and came back with *Banana, frozen*. A window made only of these is
 * skipped, so an ingredient the table genuinely doesn't cover stays unmatched — honestly
 * absent from the estimate rather than wrong in it.
 */
const MODIFIER_ONLY_WORDS = new Set(
  [
    'fresh',
    'frozen',
    'raw',
    'dried',
    'dry',
    'canned',
    'tinned',
    'cooked',
    'uncooked',
    'finely',
    'roughly',
    'thinly',
    'coarsely',
    'freshly',
    'lightly',
    'chopped',
    'sliced',
    'diced',
    'minced',
    'ground',
    'crushed',
    'grated',
    'shredded',
    'peeled',
    'trimmed',
    'boneless',
    'skinless',
    'large',
    'small',
    'medium',
    'baby',
    'mini',
    'ripe',
    'organic',
    'free',
    'range',
    'mixed',
    'assorted',
    'plain',
    'whole',
    'thick',
    'thin',
    'hot',
    'cold',
    'warm',
    'firm',
    'soft',
    'extra',
    'virgin',
    'light',
    'low',
    'reduced',
    'good',
    'quality'
  ].map(singular)
)

/**
 * Ingredients the AFCD simply doesn't name. Mapped to the words it does use rather than
 * left unmatched — an unmatched ingredient is silently dropped from the estimate, which
 * is worse than a close generic.
 */
const INGREDIENT_ALIASES: Record<string, string> = {
  spaghetti: 'pasta white wheat flour',
  penne: 'pasta white wheat flour',
  rigatoni: 'pasta white wheat flour',
  fusilli: 'pasta white wheat flour',
  macaroni: 'pasta white wheat flour',
  linguine: 'pasta white wheat flour',
  fettuccine: 'pasta white wheat flour',
  farfalle: 'pasta white wheat flour',
  tagliatelle: 'pasta white wheat flour',
  lasagne: 'pasta white wheat flour',
  'lasagne sheet': 'pasta white wheat flour',
  tortilla: 'bread tortilla',
  'coconut milk': 'coconut cream',
  'chicken stock': 'stock liquid',
  'beef stock': 'stock liquid',
  'vegetable stock': 'stock liquid',
  'fish stock': 'stock liquid',
  stock: 'stock liquid',
  'chicken broth': 'stock liquid',
  // The AFCD files nuts under "Nut, <name>" — a bare "almonds" otherwise lands on
  // almond beverage (16 kcal) or almond oil (884).
  almond: 'nut almond',
  cashew: 'nut cashew',
  walnut: 'nut walnut',
  pecan: 'nut pecan',
  'pine nut': 'nut pine',
  'plain flour': 'flour wheat plain',
  flour: 'flour wheat plain',
  // "rolled oats" only ever matches the AFCD's porridge entries, which are already
  // prepared with milk or water — the packet is filed as "Oats, hulled, uncooked".
  'rolled oat': 'oat hulled',
  'porridge oat': 'oat hulled',
  'self-raising flour': 'flour wheat white self-raising',
  'wholemeal flour': 'flour wheat wholemeal',
  passata: 'tomato puree',
  'tomato passata': 'tomato puree',
  // No black bean in the AFCD; red kidney is the closest canned pulse.
  'black bean': 'bean red kidney canned',
  'canned black bean': 'bean red kidney canned',
  // The estimator treats an ingredient line as a pre-cooking weight, which is right for
  // "250 g spaghetti" but backwards for a leftovers recipe that starts from "400 g cooked
  // rice". Without these the query backs off to the bare food and picks the dry row, so
  // 400 g of cold rice reads 1,440 kcal instead of 630.
  'cooked rice': 'rice white boiled',
  'cold cooked rice': 'rice white boiled',
  'cooked brown rice': 'rice brown boiled',
  'cooked chicken': 'chicken breast lean flesh baked',
  'cooked chicken breast': 'chicken breast lean flesh baked',
  // No edamame in the AFCD and no plain soybean either — broad beans are the closest
  // fresh green pulse. Undercounts protein a little; better than dropping the ingredient.
  edamame: 'bean broad fresh',
  'frozen edamame': 'bean broad fresh',
  // "popcorn kernels" otherwise matches frozen sweetcorn (93 kcal/100 g) instead of the
  // dry packet. The AFCD's only popcorn row is popped and buttered, so this overcounts
  // slightly where a recipe adds its own oil — still far closer than sweetcorn.
  'popcorn kernel': 'popcorn',
  // Only battered and crumbed "white flesh fish" are listed, both breadcrumbed and baked.
  // Flathead is the AFCD's plain lean white fillet.
  'white fish': 'flathead fillet',
  'white fish fillet': 'flathead fillet',
  'firm white fish': 'flathead fillet'
}

/** Lower is better. */
function estimatorScore(food: AuFood, qWords: string[]): number {
  const headWords = wordsOf(headOf(food.name))
  const nameWords = wordsOf(food.name)
  const headSet = new Set(headWords)

  let score: number
  if (headWords.length === qWords.length && qWords.every((w, i) => headWords[i] === w)) score = 0
  else if (qWords.every((w, i) => headWords[i] === w)) score = 1 // head starts with the query
  else if (qWords.every((w) => headSet.has(w))) score = 2 // head contains them, reordered
  else {
    // Matched partly in the descriptor tail. Penalise by HOW MUCH landed in the tail, so
    // "Flour, wheat, white, plain" (1 of 4 query words in the head) beats "Biscuit,
    // savoury, from white wheat flour, plain snack cracker style" (0 of 4).
    score = 3 + qWords.filter((w) => !headSet.has(w)).length * 0.5
  }

  for (const marker of PROCESSED_MARKERS) {
    if (nameWords.includes(marker) && !qWords.includes(marker)) score += 4
  }
  // Only when the match is essentially in the head: otherwise a composite dish that
  // happens to mention "regular fat milk" gets rewarded for words describing a different
  // ingredient. The cutoff allows one query word in the tail (score 3.5) — the AFCD files
  // "Beef, mince, regular fat, raw" that way, and without this the neutral row lost the
  // length tiebreak to "Beef, mince, higher fat, raw" by a single character.
  if (score < 4) {
    for (const marker of DEFAULT_MARKERS) {
      if (nameWords.includes(marker) && !qWords.includes(marker)) score -= 1
    }
  }
  return score
}

/**
 * Best AFCD food containing every query word, or null.
 *
 * Relevance decides first, and only then the tiebreaks — curated everyday forms (the ones
 * with real household measures), then the shorter, more generic name. Folding the
 * measures preference into the score instead let a *cracker* ("Biscuit, savoury, from
 * white wheat flour, plain snack cracker style", which has a serving size) outrank
 * "Flour, wheat, white, plain", which doesn't.
 */
function bestStaple(qWords: string[]): AuFood | null {
  let best: AuFood | null = null
  let bestKey: [number, number, number] = [Infinity, Infinity, Infinity]
  for (const f of AU_FOODS) {
    const nameSet = new Set(wordsOf(f.name))
    if (!qWords.every((w) => nameSet.has(w))) continue
    const key: [number, number, number] = [
      estimatorScore(f, qWords),
      f.measures && f.measures.length > 0 ? 0 : 1,
      f.name.length
    ]
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] < bestKey[2])) {
      best = f
      bestKey = key
    }
  }
  return best
}

/**
 * Per-100 g lookup for the recipe macro estimator. Every word of the ingredient must
 * appear as a whole word in the food's name; if nothing matches, trailing qualifiers are
 * dropped one at a time ("boneless chicken thigh fillets" → "boneless chicken thigh" →
 * "boneless chicken") so a wordy ingredient still lands somewhere sensible.
 */
export function staplePer100g(
  name: string
): { per100g: Per100g; servingGrams: number | null } | null {
  const cleaned = name.toLowerCase().trim()
  const aliased = INGREDIENT_ALIASES[cleaned] ?? INGREDIENT_ALIASES[singular(cleaned)] ?? cleaned
  const qWords = wordsOf(aliased)
  if (qWords.length === 0) return null

  // Try the whole phrase, then progressively shorter contiguous windows. Within a length,
  // the RIGHTMOST window goes first: English compounds put the head noun last, so
  // "chicken stock" should fall back to "stock", not to "chicken".
  let food: AuFood | null = null
  for (let n = qWords.length; n >= 1 && food === null; n--) {
    for (let start = qWords.length - n; start >= 0 && food === null; start--) {
      const window = qWords.slice(start, start + n)
      if (window.every((w) => MODIFIER_ONLY_WORDS.has(w))) continue
      food = bestStaple(window)
    }
  }
  if (!food) return null

  return {
    per100g: {
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat
    },
    servingGrams: food.measures?.[0]?.grams ?? null
  }
}

interface OffNutriments {
  'energy-kcal_100g'?: number | string
  proteins_100g?: number | string
  carbohydrates_100g?: number | string
  fat_100g?: number | string
  'energy-kcal_serving'?: number | string
  proteins_serving?: number | string
  carbohydrates_serving?: number | string
  fat_serving?: number | string
}

interface OffProduct {
  product_name?: string
  brands?: string
  code?: string | number
  serving_size?: string
  serving_quantity?: number | string
  nutriments?: OffNutriments
}

/**
 * Map an OpenFoodFacts product to a FoodItem. Pure (no network) so it can be
 * unit-tested against a saved JSON fixture. Populates a per-100 g basis and, when
 * OFF gives a serving weight, a serving measure — so branded items get the same
 * grams⇄serving flexibility as generics. Prefers per-serving macros for the flat
 * display fields when OFF supplies them, otherwise falls back to per-100 g.
 * Returns null for products with no usable name or macros.
 */
export function mapOffProduct(
  p: OffProduct,
  source: 'search' | 'barcode' = 'search'
): FoodItem | null {
  const name = (p.product_name ?? '').trim()
  const n = p.nutriments
  if (!name || !n) return null

  const cal100 = num(n['energy-kcal_100g'])
  const pro100 = num(n.proteins_100g)
  const carb100 = num(n.carbohydrates_100g)
  const fat100 = num(n.fat_100g)

  const servingCal = num(n['energy-kcal_serving'])
  const hasServing = servingCal !== null && !!p.serving_size
  const grams = num(p.serving_quantity)

  if (cal100 === null && pro100 === null && carb100 === null && fat100 === null && !hasServing) {
    return null
  }

  const brand = p.brands ? p.brands.split(',')[0].trim() : null
  const barcode = p.code !== undefined && p.code !== '' ? String(p.code) : null

  // OFF data is often partial: serving calories present but serving macros
  // missing. Derive those from per-100 g scaled by serving_quantity (grams)
  // rather than silently logging them as 0.
  const perServing = (serving: number | null, per100: number | null): number =>
    serving ?? (per100 !== null && grams !== null ? (per100 * grams) / 100 : 0)

  // Canonical per-100 g basis — from the per-100 g fields when present, else
  // back-derived from the serving values and weight.
  let per100g: Per100g | undefined
  if (cal100 !== null || pro100 !== null || carb100 !== null || fat100 !== null) {
    per100g = {
      calories: round0(cal100 ?? 0),
      protein: round1(pro100 ?? 0),
      carbs: round1(carb100 ?? 0),
      fat: round1(fat100 ?? 0)
    }
  } else if (hasServing && grams !== null && grams > 0) {
    const to100 = (v: number): number => (v * 100) / grams
    per100g = {
      calories: round0(to100(servingCal ?? 0)),
      protein: round1(to100(perServing(num(n.proteins_serving), null))),
      carbs: round1(to100(perServing(num(n.carbohydrates_serving), null))),
      fat: round1(to100(perServing(num(n.fat_serving), null)))
    }
  }

  const measures: FoodMeasure[] =
    grams !== null && grams > 0 ? [{ desc: p.serving_size?.trim() || `${round0(grams)} g`, grams }] : []

  if (hasServing) {
    return {
      name,
      brand,
      barcode,
      servingDesc: p.serving_size ?? null,
      unit: 'serving',
      calories: round0(servingCal ?? 0),
      protein: round1(perServing(num(n.proteins_serving), pro100)),
      carbs: round1(perServing(num(n.carbohydrates_serving), carb100)),
      fat: round1(perServing(num(n.fat_serving), fat100)),
      source,
      per100g,
      measures
    }
  }

  return {
    name,
    brand,
    barcode,
    servingDesc: 'per 100 g',
    unit: '100g',
    calories: round0(cal100 ?? 0),
    protein: round1(pro100 ?? 0),
    carbs: round1(carb100 ?? 0),
    fat: round1(fat100 ?? 0),
    source,
    per100g,
    measures
  }
}
