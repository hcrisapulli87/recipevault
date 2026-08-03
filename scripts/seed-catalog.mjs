// Seed (or re-seed) the recipe catalog into Supabase.
//
// The catalog is the pool of recipes the week generator plans from — see
// src/shared/data/catalog-recipes.json. This script is idempotent: rows are upserted on
// `catalog_slug`, so run it again every time recipes are added or corrected. It never
// touches the household's own imports (is_catalog = false).
//
// Ingredient lines are parsed with the same parser the URL scraper uses, and macros are
// estimated against the bundled AU food table — the same numbers the tracker's "log the
// planned meal" card reads back out.
//
// Usage (from the repo root, Node 18+). Values are read from .env if present.
//
//   Dry run — parses everything, computes estimates, prints the report, writes nothing.
//   Needs no credentials at all:
//
//     node scripts/seed-catalog.mjs --dry-run
//
//   Real run — auth option A, service role key (works with magic-link accounts):
//     $env:VITE_SUPABASE_URL = 'https://<project>.supabase.co'
//     $env:SUPABASE_SERVICE_ROLE_KEY = '<service role key>'   # secret, bypasses RLS
//     $env:SEED_EMAIL = 'you@example.com'                     # who owns the catalog rows
//     node scripts/seed-catalog.mjs
//
//   Real run — auth option B, email + password (RLS still applies, no secret key):
//     $env:VITE_SUPABASE_URL = 'https://<project>.supabase.co'
//     $env:VITE_SUPABASE_PUBLISHABLE_KEY = '<publishable key>'
//     $env:SEED_EMAIL = 'you@example.com'
//     $env:SEED_PASSWORD = '<password>'
//     node scripts/seed-catalog.mjs
//
//   Options:
//     --dry-run        parse + estimate only, no network, no writes
//     --only=<slug>    restrict to one recipe (repeatable, comma-separated)

import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)

// ── tiny .env loader (no dependency; the app's own config uses Vite for this) ──
function loadEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    const value = m[2].replace(/^["']|["']$/g, '')
    if (process.env[m[1]] === undefined && value) process.env[m[1]] = value
  }
}
loadEnv()

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const ONLY = args
  .filter((a) => a.startsWith('--only='))
  .flatMap((a) => a.slice('--only='.length).split(','))
  .filter(Boolean)

// ── load the shared TS modules ────────────────────────────────────────────────
// The parser, estimator and food table are TypeScript. Rather than duplicate them here
// (which is how a seeder drifts from the app and starts reporting different macros than
// the UI), bundle them with esbuild — already present as a Vite dependency — and import
// the result. The cache directory is inside node_modules, so it is already gitignored.
const CACHE_DIR = resolve('node_modules/.cache/recipe-vault')
const BUNDLE = resolve(CACHE_DIR, 'seed-shared.mjs')

mkdirSync(CACHE_DIR, { recursive: true })
await require('esbuild').build({
  stdin: {
    contents: `
      export { parseIngredient } from './src/shared/ingredient-parser'
      export { staplePer100g } from './src/shared/nutrition'
      export { estimateRecipeMacros } from './src/shared/macro-estimator'
    `,
    resolveDir: resolve('.'),
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: BUNDLE,
  logLevel: 'warning'
})

const { parseIngredient, staplePer100g, estimateRecipeMacros } = await import(
  pathToFileURL(BUNDLE).href
)
rmSync(BUNDLE, { force: true })

const catalog = JSON.parse(readFileSync('src/shared/data/catalog-recipes.json', 'utf8'))
const recipes = ONLY.length > 0 ? catalog.filter((r) => ONLY.includes(r.slug)) : catalog

if (recipes.length === 0) {
  console.error('No recipes selected. Check --only=<slug>.')
  process.exit(1)
}

/** cleanName from src/renderer/data/macroEstimate.ts — kept identical on purpose. */
const cleanName = (name) => name.replace(/\(.*?\)/g, '').split(',')[0].trim()

/** Parse one recipe's ingredient lines and estimate its per-serving macros offline. */
function prepare(recipe) {
  const ingredients = recipe.ingredients.map((raw, i) => ({ ...parseIngredient(raw), position: i }))
  const matches = ingredients.map((ing) => staplePer100g(cleanName(ing.name)))
  const { estimate } = estimateRecipeMacros(ingredients, recipe.servings, matches)
  const unmatched = ingredients.filter((_, i) => matches[i] === null).map((ing) => ing.name)
  return { ingredients, estimate, unmatched }
}

const prepared = recipes.map((r) => ({ recipe: r, ...prepare(r) }))

// ── report ────────────────────────────────────────────────────────────────────
console.log(`\nCatalog: ${prepared.length} recipes\n`)
const poor = []
for (const p of prepared) {
  const rate = p.estimate.matched / p.estimate.total
  const flag = rate < 0.6 ? '  <-- LOW MATCH' : ''
  if (rate < 0.6) poor.push(p)
  console.log(
    `${p.recipe.slug.padEnd(34)} ${String(Math.round(p.estimate.calories)).padStart(4)} kcal` +
      `  P${String(Math.round(p.estimate.protein)).padStart(3)}` +
      `  C${String(Math.round(p.estimate.carbs)).padStart(3)}` +
      `  F${String(Math.round(p.estimate.fat)).padStart(3)}` +
      `  matched ${p.estimate.matched}/${p.estimate.total}${flag}`
  )
  if (p.unmatched.length > 0) console.log(`${' '.repeat(36)}unmatched: ${p.unmatched.join(', ')}`)
}

if (poor.length > 0) {
  console.log(
    `\n${poor.length} recipe(s) matched under 60% of their ingredients. Their estimates will ` +
      `read low — reword those lines before relying on the numbers.`
  )
}

if (DRY_RUN) {
  console.log('\nDry run: nothing written.\n')
  process.exit(0)
}

// ── write ─────────────────────────────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js')

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const email = process.env.SEED_EMAIL
const password = process.env.SEED_PASSWORD

if (!url) {
  console.error('VITE_SUPABASE_URL is not set. See the header of this file.')
  process.exit(1)
}
if (!email) {
  console.error('SEED_EMAIL is not set — the catalog rows need an owner.')
  process.exit(1)
}

let supabase
let ownerId

if (serviceKey) {
  supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) throw new Error(`Could not list users: ${error.message}`)
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) throw new Error(`No user with email ${email} in this project.`)
  ownerId = user.id
} else if (publishableKey && password) {
  supabase = createClient(url, publishableKey, { auth: { persistSession: false } })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Sign-in failed: ${error.message}`)
  ownerId = data.user.id
} else {
  console.error(
    'No usable credentials. Set SUPABASE_SERVICE_ROLE_KEY, or both ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY and SEED_PASSWORD. See the header of this file.'
  )
  process.exit(1)
}

console.log(`\nSeeding as ${email} (${ownerId})\n`)

let created = 0
let updated = 0

for (const { recipe, ingredients, estimate } of prepared) {
  const { data: existing, error: findError } = await supabase
    .from('recipes')
    .select('id')
    .eq('catalog_slug', recipe.slug)
    .maybeSingle()
  if (findError) throw new Error(`${recipe.slug}: ${findError.message}`)

  const row = {
    owner_id: ownerId,
    title: recipe.title,
    source_url: null,
    image_url: recipe.imageUrl ?? null,
    description: recipe.description,
    servings: recipe.servings,
    prep_min: recipe.prepMin ?? null,
    cook_min: recipe.cookMin ?? null,
    total_min: (recipe.prepMin ?? 0) + (recipe.cookMin ?? 0) || null,
    is_catalog: true,
    catalog_slug: recipe.slug,
    cuisine: recipe.cuisine,
    diet_tags: recipe.dietTags,
    meal_slots: recipe.mealSlots,
    effort: recipe.effort,
    keeps_days: recipe.keepsDays,
    batch_friendly: recipe.batchFriendly,
    reheat: recipe.reheat,
    est_cal_serve: estimate.calories,
    est_protein_serve: estimate.protein,
    est_carbs_serve: estimate.carbs,
    est_fat_serve: estimate.fat,
    est_matched: estimate.matched,
    est_total: estimate.total,
    est_computed_at: new Date().toISOString()
  }

  let id
  if (existing) {
    const { error } = await supabase.from('recipes').update(row).eq('id', existing.id)
    if (error) throw new Error(`${recipe.slug}: ${error.message}`)
    id = existing.id
    updated++
  } else {
    const { data, error } = await supabase.from('recipes').insert(row).select('id').single()
    if (error) throw new Error(`${recipe.slug}: ${error.message}`)
    id = data.id
    created++
  }

  // Children are replaced wholesale — simpler and safer than diffing, and the only
  // writer of these rows is this script.
  for (const table of ['ingredients', 'steps']) {
    const { error } = await supabase.from(table).delete().eq('recipe_id', id)
    if (error) throw new Error(`${recipe.slug}: clearing ${table}: ${error.message}`)
  }

  const { error: ie } = await supabase.from('ingredients').insert(
    ingredients.map((ing) => ({
      owner_id: ownerId,
      recipe_id: id,
      position: ing.position,
      raw_text: ing.raw,
      quantity: ing.quantity,
      quantity_max: ing.quantityMax,
      unit: ing.unit,
      name: ing.name
    }))
  )
  if (ie) throw new Error(`${recipe.slug}: ingredients: ${ie.message}`)

  const { error: se } = await supabase.from('steps').insert(
    recipe.steps.map((text, i) => ({
      owner_id: ownerId,
      recipe_id: id,
      position: i,
      section: null,
      text
    }))
  )
  if (se) throw new Error(`${recipe.slug}: steps: ${se.message}`)

  process.stdout.write('.')
}

console.log(`\n\nDone. ${created} created, ${updated} updated, ${prepared.length} total.\n`)
