// One-time build: FSANZ Australian Food Composition Database (AFCD Release 3.0)
// → src/shared/data/au-foods.json  (bundled offline generic-food macro DB).
//
// Source (CC BY, attribution required):
//   https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd
//   Files: "AFCD Release 3 - Nutrient profiles.xlsx" (all we need — it carries
//   the food name + per-100 g macros). Placed in scripts/.afcd/ (gitignored).
//
// AFCD Release 3 has no household-measures file, so real serving sizes are
// applied here from a small keyword→measure rules table (MEASURE_RULES). Foods
// with no rule ship measures:[] and are logged in grams (the accepted fallback).
//
// Run:  node scripts/build-au-foods.mjs
import * as XLSX from 'xlsx'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, '.afcd/nutrient-profiles.xlsx')
const OUT = resolve(__dirname, '../src/shared/data/au-foods.json')
const SHEET = 'All solids & liquids per 100 g'

// Column indices in the "per 100 g" sheet (header on row 2, data from row 3).
const COL = {
  key: 0,
  name: 3,
  energyKj: 4, // "Energy with dietary fibre, equated (kJ)"
  protein: 7, // "Protein (g)"
  fat: 9, // "Fat, total (g)"
  carb: 38, // "Available carbohydrate, without sugar alcohols (g)"
  carbAlt: 39 // "Available carbohydrate, with sugar alcohols (g)" (fallback)
}

const KJ_PER_KCAL = 4.184
const r0 = (n) => Math.round(n)
const r1 = (n) => Math.round(n * 10) / 10

// Real AU household serving sizes, applied by matching the (lowercased) food
// name. First matching rule wins. Keep these conservative and common — they
// exist to make the everyday searches (pasta/rice/bread/egg/banana…) loggable
// by serving; everything else falls back to grams.
// \bcooked\b / \bboiled\b avoid matching "uncooked"; exclusions keep cooked-portion
// measures off dry/powder/flour forms of the same food.
const MEASURE_RULES = [
  { re: /^egg, chicken.*(\bboiled\b|poached|\braw\b|fried|scrambled|omelette)/, m: [['1 egg', 50], ['2 eggs', 100]] },
  { re: /^rice, (?!.*(flour|bran|cake|cracker)).*(\bboiled\b|cooker|steamed|\bcooked\b)/, m: [['½ cup', 90], ['1 cup', 180]] },
  { re: /^pasta, .*(\bboiled\b|\bcooked\b)/, m: [['½ cup', 65], ['1 cup', 130]] },
  { re: /^noodle.*(\bboiled\b|\bcooked\b|hokkien|udon)/, m: [['1 cup', 160]] },
  { re: /^couscous.*(\bcooked\b|\bboiled\b)/, m: [['1 cup', 155]] },
  { re: /^quinoa.*(\bcooked\b|\bboiled\b)/, m: [['1 cup', 185]] },
  { re: /^bread, (?!.*crumb).*/, m: [['1 slice', 30], ['2 slices', 60]] },
  { re: /^roll, bread/, m: [['1 roll', 70]] },
  { re: /^breakfast cereal/, m: [['1 cup', 40], ['½ cup', 20]] },
  { re: /^oat.*(rolled|porridge)/, m: [['½ cup dry', 40], ['1 cup cooked', 220]] },
  { re: /^potato, (?!.*(crisp|chip|flour|powder)).*(baked|\bboiled\b|mashed|roast|steamed)/, m: [['1 medium', 150]] },
  { re: /^sweet potato, .*(baked|\bboiled\b|roast|steamed)/, m: [['1 medium', 130]] },
  { re: /^banana, .*raw/, m: [['1 medium', 120]] },
  { re: /^apple, .*raw/, m: [['1 medium', 150]] },
  { re: /^orange, .*raw/, m: [['1 medium', 130]] },
  { re: /^pear, .*raw/, m: [['1 medium', 165]] },
  { re: /^mandarin.*raw/, m: [['1 medium', 75]] },
  { re: /^strawberr.*raw/, m: [['1 cup', 150]] },
  { re: /^blueberr.*raw/, m: [['1 cup', 150]] },
  { re: /^grape.*raw/, m: [['1 cup', 150]] },
  { re: /^avocado.*raw/, m: [['½ avocado', 100]] },
  { re: /^tomato, .*raw/, m: [['1 medium', 120]] },
  { re: /^carrot, .*(\braw\b|\bboiled\b|steamed)/, m: [['1 medium', 60]] },
  { re: /^broccoli, .*(\bboiled\b|steamed|\braw\b)/, m: [['1 cup', 90]] },
  { re: /^spinach, .*(raw|baby)/, m: [['1 cup', 30]] },
  { re: /^milk, (?!.*(powder|dried|condensed|evaporated)).*(fluid|uht)/, m: [['1 cup', 250], ['1 glass', 250]] },
  { re: /^yoghurt,/, m: [['1 tub', 170], ['1 cup', 200]] },
  { re: /^cheese, (cheddar|tasty|colby|edam|swiss|mozzarella|processed)/, m: [['1 slice', 20], ['1 cube', 30]] },
  { re: /^butter,/, m: [['1 tsp', 5], ['1 tbsp', 14]] },
  { re: /^oil, (olive|vegetable|canola|sunflower)/, m: [['1 tbsp', 14]] },
  { re: /chicken.*breast.*(baked|grilled|roast|\bcooked\b|steamed|barbecued)/, m: [['1 breast', 130]] },
  { re: /chicken.*thigh.*(baked|grilled|roast|\bcooked\b|barbecued)/, m: [['1 thigh', 90]] },
  { re: /beef.*steak.*(grilled|\bcooked\b|fried|barbecued)/, m: [['1 steak', 150]] },
  { re: /(beef|lamb|pork).*mince.*(\bcooked\b|fried)/, m: [['100 g', 100]] },
  { re: /^fish, .*(baked|grilled|steamed|fried)/, m: [['1 fillet', 120]] },
  { re: /^salmon.*(baked|grilled|smoked|\braw\b)/, m: [['1 fillet', 120]] },
  { re: /^tuna.*canned/, m: [['1 small can', 95]] },
  { re: /^sausage, /, m: [['1 sausage', 70]] },
  { re: /^bacon, /, m: [['1 rasher', 30]] },
  { re: /^peanut butter/, m: [['1 tbsp', 20], ['2 tbsp', 40]] },
  { re: /^almond.*(raw|roasted)/, m: [['1 handful', 30]] },
  { re: /^chocolate, /, m: [['1 row', 20], ['1 block', 40]] },
  { re: /^biscuit, /, m: [['1 biscuit', 15]] }
]

function measuresFor(nameLower) {
  const rule = MEASURE_RULES.find((r) => r.re.test(nameLower))
  return rule ? rule.m.map(([desc, grams]) => ({ desc, grams })) : []
}

function build() {
  const wb = XLSX.read(readFileSync(SRC), { type: 'buffer' })
  const ws = wb.Sheets[SHEET]
  if (!ws) throw new Error(`Sheet "${SHEET}" not found in ${SRC}`)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false })
  const data = rows.slice(2) // header row is index 1

  const foods = []
  let withMeasures = 0
  for (const r of data) {
    const key = r[COL.key]
    const name = typeof r[COL.name] === 'string' ? r[COL.name].trim() : null
    const kj = Number(r[COL.energyKj])
    const protein = Number(r[COL.protein])
    const fat = Number(r[COL.fat])
    const carbRaw = r[COL.carb] ?? r[COL.carbAlt]
    const carbs = Number(carbRaw)
    if (!key || !name) continue
    if (![kj, protein, fat, carbs].every(Number.isFinite)) continue

    const nameLower = name.toLowerCase()
    const measures = measuresFor(nameLower)
    if (measures.length) withMeasures++
    foods.push({
      key: String(key),
      name,
      calories: r0(kj / KJ_PER_KCAL),
      protein: r1(protein),
      carbs: r1(carbs),
      fat: r1(fat),
      ...(measures.length ? { measures } : {})
    })
  }

  // Sanity asserts — fail loudly rather than shipping garbage.
  if (foods.length < 1000) throw new Error(`Only ${foods.length} foods — expected >1000`)
  for (const f of foods) {
    for (const k of ['calories', 'protein', 'carbs', 'fat']) {
      const v = f[k]
      if (!Number.isFinite(v) || v < 0 || v > 1000) {
        throw new Error(`Bad ${k}=${v} for "${f.name}"`)
      }
    }
  }
  if (withMeasures < 40) throw new Error(`Only ${withMeasures} foods got measures — rules broken?`)

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(foods) + '\n')
  console.log(`Wrote ${foods.length} foods (${withMeasures} with measures) → ${OUT}`)
}

build()
