// One-time migration: local Electron sqlite → Supabase.
//
// Copies recipes (+ ingredients/steps) and, optionally, the macro-tracker food log
// from the old desktop database into the cloud, stamped with YOUR user id.
// Idempotent: recipes whose title already exists in Supabase are skipped, and the
// food log is only copied when the cloud log is empty.
//
// Usage (run from the repo root, Node 18+):
//
//   Auth option A — service role key (works with magic-link accounts; recommended):
//     Supabase dashboard → Project Settings → API keys → service_role (keep it secret,
//     don't commit it — it bypasses RLS).
//
//       $env:VITE_SUPABASE_URL = 'https://<project>.supabase.co'
//       $env:SUPABASE_SERVICE_ROLE_KEY = '<service role key>'
//       $env:MIGRATE_EMAIL = 'you@example.com'        # which user owns the data
//       node scripts/migrate-to-supabase.mjs
//
//   Auth option B — email + password (only if the user has a password set):
//       $env:VITE_SUPABASE_URL = 'https://<project>.supabase.co'
//       $env:VITE_SUPABASE_PUBLISHABLE_KEY = '<publishable key>'
//       $env:MIGRATE_EMAIL = 'you@example.com'
//       $env:MIGRATE_PASSWORD = '<password>'
//       node scripts/migrate-to-supabase.mjs
//
//   Options:
//     $env:MIGRATE_DB       — path to the sqlite file (default: %APPDATA%\recipe-vault\recipe-vault.sqlite)
//     $env:MIGRATE_FOOD_LOG — set to '1' to also copy the food log (from the old
//                             profile named by $env:MIGRATE_PROFILE, default "Me")
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import initSqlJs from 'sql.js'
import { createClient } from '@supabase/supabase-js'

const url = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const email = process.env.MIGRATE_EMAIL
const password = process.env.MIGRATE_PASSWORD

if (!url || !email || !(serviceKey || (publishableKey && password))) {
  console.error(
    'Missing env. Need VITE_SUPABASE_URL, MIGRATE_EMAIL, and either\n' +
      'SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_PUBLISHABLE_KEY + MIGRATE_PASSWORD.\n' +
      'See the header of this script for full usage.'
  )
  process.exit(1)
}

const dbPath =
  process.env.MIGRATE_DB ??
  join(process.env.APPDATA ?? '', 'recipe-vault', 'recipe-vault.sqlite')
if (!existsSync(dbPath)) {
  console.error(`sqlite file not found: ${dbPath} (set MIGRATE_DB to override)`)
  process.exit(1)
}

// ── connect + resolve the owning user ────────────────────────────────────────
let supabase
let userId
if (serviceKey) {
  supabase = createClient(url, serviceKey, { auth: { persistSession: false } })
  // service role bypasses RLS, so owner_id must be stamped explicitly below
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error(`listUsers failed: ${error.message}`)
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!user) throw new Error(`No Supabase user with email ${email}`)
  userId = user.id
} else {
  supabase = createClient(url, publishableKey, { auth: { persistSession: false } })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Sign-in failed: ${error.message}`)
  userId = data.user.id
}
console.log(`Migrating ${dbPath}\n  → ${url} as ${email} (${userId})`)

// ── open the old database ─────────────────────────────────────────────────────
const SQL = await initSqlJs({
  locateFile: (f) => join(process.cwd(), 'node_modules', 'sql.js', 'dist', f)
})
const db = new SQL.Database(readFileSync(dbPath))

function rows(query, params = []) {
  const stmt = db.prepare(query)
  stmt.bind(params)
  const out = []
  while (stmt.step()) out.push(stmt.getAsObject())
  stmt.free()
  return out
}

// ── recipes + ingredients + steps (idempotent on title) ──────────────────────
const { data: existing, error: exErr } = await supabase
  .from('recipes')
  .select('title')
  .eq('owner_id', userId)
if (exErr) throw new Error(`reading existing recipes failed: ${exErr.message}`)
const have = new Set((existing ?? []).map((r) => r.title))

let migrated = 0
let skipped = 0
for (const r of rows('SELECT * FROM recipes ORDER BY id')) {
  if (have.has(r.title)) {
    skipped++
    continue
  }
  const { data: inserted, error } = await supabase
    .from('recipes')
    .insert({
      owner_id: userId,
      title: r.title,
      source_url: r.source_url,
      image_url: r.image_url,
      description: r.description ?? '',
      servings: r.servings,
      prep_min: r.prep_min,
      cook_min: r.cook_min,
      total_min: r.total_min,
      created_at: r.created_at
    })
    .select('id')
    .single()
  if (error) throw new Error(`inserting "${r.title}" failed: ${error.message}`)
  const newId = inserted.id

  const ingredients = rows('SELECT * FROM ingredients WHERE recipe_id = ? ORDER BY position', [
    r.id
  ]).map((i) => ({
    owner_id: userId,
    recipe_id: newId,
    position: i.position,
    raw_text: i.raw_text,
    quantity: i.quantity,
    quantity_max: i.quantity_max,
    unit: i.unit,
    name: i.name
  }))
  if (ingredients.length) {
    const { error: iErr } = await supabase.from('ingredients').insert(ingredients)
    if (iErr) throw new Error(`ingredients for "${r.title}" failed: ${iErr.message}`)
  }

  const steps = rows('SELECT * FROM steps WHERE recipe_id = ? ORDER BY position', [r.id]).map(
    (s) => ({
      owner_id: userId,
      recipe_id: newId,
      position: s.position,
      section: s.section,
      text: s.text
    })
  )
  if (steps.length) {
    const { error: sErr } = await supabase.from('steps').insert(steps)
    if (sErr) throw new Error(`steps for "${r.title}" failed: ${sErr.message}`)
  }
  migrated++
  console.log(`  ✓ ${r.title} (${ingredients.length} ingredients, ${steps.length} steps)`)
}
console.log(`Recipes: ${migrated} migrated, ${skipped} already present.`)

// ── food log (optional; only when the cloud log is empty) ────────────────────
if (process.env.MIGRATE_FOOD_LOG === '1') {
  const profileName = process.env.MIGRATE_PROFILE ?? 'Me'
  const profile = rows('SELECT id FROM profiles WHERE name = ?', [profileName])[0]
  if (!profile) {
    console.log(`Food log: no old profile named "${profileName}" — skipped.`)
  } else {
    const { count, error: cErr } = await supabase
      .from('food_log')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId)
    if (cErr) throw new Error(`reading cloud food_log failed: ${cErr.message}`)
    if ((count ?? 0) > 0) {
      console.log(`Food log: cloud log already has ${count} entries — skipped (idempotent).`)
    } else {
      const entries = rows('SELECT * FROM food_log WHERE profile_id = ? ORDER BY id', [
        profile.id
      ]).map((e) => ({
        owner_id: userId,
        log_date: e.log_date,
        meal_type: e.meal_type,
        name: e.name,
        brand: e.brand,
        amount: e.amount,
        unit: e.unit,
        base_calories: e.base_calories,
        base_protein: e.base_protein,
        base_carbs: e.base_carbs,
        base_fat: e.base_fat,
        barcode: e.barcode,
        source: e.source,
        created_at: e.created_at
      }))
      for (let i = 0; i < entries.length; i += 500) {
        const { error } = await supabase.from('food_log').insert(entries.slice(i, i + 500))
        if (error) throw new Error(`food_log insert failed: ${error.message}`)
      }
      console.log(`Food log: ${entries.length} entries migrated from profile "${profileName}".`)
    }
  }
}

db.close()
console.log('Done.')
