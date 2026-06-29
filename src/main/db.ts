import type { Database } from 'sql.js'
import { DAYS, MEAL_TYPES } from '../shared/types'
import type {
  DailyLog,
  DailyTotals,
  Day,
  DraftLogEntry,
  DraftRecipe,
  FoodItem,
  LogEntry,
  MealPlanEntry,
  MealType,
  Profile,
  ProfileGoals,
  Recipe,
  RecipeIngredient,
  RecipeStep,
  RecipeSummary
} from '../shared/types'

export function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS recipes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      source_url  TEXT,
      image_url   TEXT,
      description TEXT NOT NULL DEFAULT '',
      servings    INTEGER,
      prep_min    INTEGER,
      cook_min    INTEGER,
      total_min   INTEGER,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ingredients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id    INTEGER NOT NULL REFERENCES recipes(id),
      position     INTEGER NOT NULL,
      raw_text     TEXT NOT NULL,
      quantity     REAL,
      quantity_max REAL,
      unit         TEXT,
      name         TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS steps (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id),
      position  INTEGER NOT NULL,
      section   TEXT,
      text      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meal_plan (
      day       TEXT PRIMARY KEY CHECK(day IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
      recipe_id INTEGER REFERENCES recipes(id),
      free_text TEXT
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      cal_goal     REAL,
      protein_goal REAL,
      carbs_goal   REAL,
      fat_goal     REAL,
      created_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS food_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id    INTEGER NOT NULL REFERENCES profiles(id),
      log_date      TEXT NOT NULL,
      meal_type     TEXT NOT NULL CHECK(meal_type IN ('breakfast','lunch','dinner','snack')),
      name          TEXT NOT NULL,
      brand         TEXT,
      amount        REAL NOT NULL DEFAULT 1,
      unit          TEXT NOT NULL DEFAULT 'serving',
      base_calories REAL NOT NULL DEFAULT 0,
      base_protein  REAL NOT NULL DEFAULT 0,
      base_carbs    REAL NOT NULL DEFAULT 0,
      base_fat      REAL NOT NULL DEFAULT 0,
      barcode       TEXT,
      source        TEXT NOT NULL DEFAULT 'manual',
      created_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_food_log_day ON food_log(profile_id, log_date);
    CREATE TABLE IF NOT EXISTS food_cache (
      barcode          TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      brand            TEXT,
      serving_desc     TEXT,
      unit             TEXT NOT NULL,
      cal_per_unit     REAL NOT NULL DEFAULT 0,
      protein_per_unit REAL NOT NULL DEFAULT 0,
      carbs_per_unit   REAL NOT NULL DEFAULT 0,
      fat_per_unit     REAL NOT NULL DEFAULT 0,
      last_fetched     TEXT NOT NULL
    );
  `)
}

/** Seed a starter profile so the tracker is usable on first run. */
export function ensureDefaultProfile(db: Database): void {
  const stmt = db.prepare('SELECT COUNT(*) AS n FROM profiles')
  stmt.step()
  const n = Number(stmt.getAsObject()['n'])
  stmt.free()
  if (n === 0) {
    db.run('INSERT INTO profiles (name, created_at) VALUES (?, ?)', [
      'Me',
      new Date().toISOString()
    ])
  }
}

function nullableNum(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v)
}

function nullableStr(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v)
}

export function getRecipes(db: Database): RecipeSummary[] {
  const stmt = db.prepare('SELECT id, title, image_url, total_min FROM recipes ORDER BY title')
  const rows: RecipeSummary[] = []
  while (stmt.step()) {
    const r = stmt.getAsObject()
    rows.push({
      id: Number(r['id']),
      title: String(r['title']),
      imageUrl: nullableStr(r['image_url']),
      totalMin: nullableNum(r['total_min'])
    })
  }
  stmt.free()
  return rows
}

export function getRecipe(db: Database, id: number): Recipe | null {
  const stmt = db.prepare('SELECT * FROM recipes WHERE id = ?')
  stmt.bind([id])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const r = stmt.getAsObject()
  stmt.free()

  const ingredients: RecipeIngredient[] = []
  const ing = db.prepare(
    'SELECT position, raw_text, quantity, quantity_max, unit, name FROM ingredients WHERE recipe_id = ? ORDER BY position'
  )
  ing.bind([id])
  while (ing.step()) {
    const row = ing.getAsObject()
    ingredients.push({
      position: Number(row['position']),
      raw: String(row['raw_text']),
      quantity: nullableNum(row['quantity']),
      quantityMax: nullableNum(row['quantity_max']),
      unit: nullableStr(row['unit']),
      name: String(row['name'])
    })
  }
  ing.free()

  const steps: RecipeStep[] = []
  const st = db.prepare(
    'SELECT position, section, text FROM steps WHERE recipe_id = ? ORDER BY position'
  )
  st.bind([id])
  while (st.step()) {
    const row = st.getAsObject()
    steps.push({
      position: Number(row['position']),
      section: nullableStr(row['section']),
      text: String(row['text'])
    })
  }
  st.free()

  return {
    id: Number(r['id']),
    title: String(r['title']),
    sourceUrl: nullableStr(r['source_url']),
    imageUrl: nullableStr(r['image_url']),
    description: String(r['description'] ?? ''),
    servings: nullableNum(r['servings']),
    prepMin: nullableNum(r['prep_min']),
    cookMin: nullableNum(r['cook_min']),
    totalMin: nullableNum(r['total_min']),
    createdAt: String(r['created_at']),
    ingredients,
    steps
  }
}

export function saveRecipe(db: Database, draft: DraftRecipe): number {
  // RETURNING reads the new id from the INSERT itself, so it can't be lost to a
  // db.export() / persistence step between the insert and a separate rowid query.
  const stmt = db.prepare(
    `INSERT INTO recipes (title, source_url, image_url, description, servings, prep_min, cook_min, total_min, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  )
  stmt.bind([
    draft.title,
    draft.sourceUrl,
    draft.imageUrl,
    draft.description,
    draft.servings,
    draft.prepMin,
    draft.cookMin,
    draft.totalMin,
    new Date().toISOString()
  ])
  stmt.step()
  const id = Number(stmt.getAsObject()['id'])
  stmt.free()

  for (const i of draft.ingredients) {
    db.run(
      'INSERT INTO ingredients (recipe_id, position, raw_text, quantity, quantity_max, unit, name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, i.position, i.raw, i.quantity, i.quantityMax, i.unit, i.name]
    )
  }
  for (const s of draft.steps) {
    db.run('INSERT INTO steps (recipe_id, position, section, text) VALUES (?, ?, ?, ?)', [
      id,
      s.position,
      s.section,
      s.text
    ])
  }
  return id
}

export function deleteRecipe(db: Database, id: number): void {
  db.run('UPDATE meal_plan SET recipe_id = NULL WHERE recipe_id = ?', [id])
  db.run('DELETE FROM ingredients WHERE recipe_id = ?', [id])
  db.run('DELETE FROM steps WHERE recipe_id = ?', [id])
  db.run('DELETE FROM recipes WHERE id = ?', [id])
}

export function getMealPlan(db: Database): MealPlanEntry[] {
  const stored = new Map<string, { recipeId: number | null; freeText: string | null }>()
  const stmt = db.prepare('SELECT day, recipe_id, free_text FROM meal_plan')
  while (stmt.step()) {
    const r = stmt.getAsObject()
    stored.set(String(r['day']), {
      recipeId: nullableNum(r['recipe_id']),
      freeText: nullableStr(r['free_text'])
    })
  }
  stmt.free()
  return DAYS.map((day) => ({
    day,
    recipeId: stored.get(day)?.recipeId ?? null,
    freeText: stored.get(day)?.freeText ?? null
  }))
}

export function setMeal(
  db: Database,
  day: Day,
  recipeId: number | null,
  freeText: string | null
): void {
  db.run(
    `INSERT INTO meal_plan (day, recipe_id, free_text) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET recipe_id = excluded.recipe_id, free_text = excluded.free_text`,
    [day, recipeId, freeText]
  )
}

export function clearWeek(db: Database): void {
  db.run('DELETE FROM meal_plan')
}

// ── macro / meal tracker ──────────────────────────────────────────────────────

function rowToProfile(r: Record<string, unknown>): Profile {
  return {
    id: Number(r['id']),
    name: String(r['name']),
    calGoal: nullableNum(r['cal_goal']),
    proteinGoal: nullableNum(r['protein_goal']),
    carbsGoal: nullableNum(r['carbs_goal']),
    fatGoal: nullableNum(r['fat_goal'])
  }
}

export function getProfiles(db: Database): Profile[] {
  const stmt = db.prepare('SELECT * FROM profiles ORDER BY id')
  const rows: Profile[] = []
  while (stmt.step()) rows.push(rowToProfile(stmt.getAsObject()))
  stmt.free()
  return rows
}

export function addProfile(db: Database, name: string): number {
  const stmt = db.prepare('INSERT INTO profiles (name, created_at) VALUES (?, ?) RETURNING id')
  stmt.bind([name, new Date().toISOString()])
  stmt.step()
  const id = Number(stmt.getAsObject()['id'])
  stmt.free()
  return id
}

export function updateProfile(
  db: Database,
  id: number,
  patch: { name?: string; goals?: ProfileGoals }
): void {
  if (patch.name !== undefined) {
    db.run('UPDATE profiles SET name = ? WHERE id = ?', [patch.name, id])
  }
  if (patch.goals) {
    db.run(
      'UPDATE profiles SET cal_goal = ?, protein_goal = ?, carbs_goal = ?, fat_goal = ? WHERE id = ?',
      [patch.goals.calGoal, patch.goals.proteinGoal, patch.goals.carbsGoal, patch.goals.fatGoal, id]
    )
  }
}

export function deleteProfile(db: Database, id: number): void {
  db.run('DELETE FROM food_log WHERE profile_id = ?', [id])
  db.run('DELETE FROM profiles WHERE id = ?', [id])
}

function rowToLogEntry(r: Record<string, unknown>): LogEntry {
  return {
    id: Number(r['id']),
    mealType: String(r['meal_type']) as MealType,
    name: String(r['name']),
    brand: nullableStr(r['brand']),
    amount: Number(r['amount']),
    unit: String(r['unit']),
    baseCalories: Number(r['base_calories']),
    baseProtein: Number(r['base_protein']),
    baseCarbs: Number(r['base_carbs']),
    baseFat: Number(r['base_fat']),
    barcode: nullableStr(r['barcode']),
    source: String(r['source'])
  }
}

/** Sum the macros actually consumed (per-unit macros × amount) across entries. */
export function computeTotals(entries: LogEntry[]): DailyTotals {
  return entries.reduce(
    (acc, e) => ({
      calories: acc.calories + e.baseCalories * e.amount,
      protein: acc.protein + e.baseProtein * e.amount,
      carbs: acc.carbs + e.baseCarbs * e.amount,
      fat: acc.fat + e.baseFat * e.amount
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  )
}

export function getDailyLog(db: Database, profileId: number, date: string): DailyLog {
  const stmt = db.prepare(
    'SELECT * FROM food_log WHERE profile_id = ? AND log_date = ? ORDER BY id'
  )
  stmt.bind([profileId, date])
  const entries: LogEntry[] = []
  while (stmt.step()) entries.push(rowToLogEntry(stmt.getAsObject()))
  stmt.free()

  const meals = Object.fromEntries(MEAL_TYPES.map((m) => [m, [] as LogEntry[]])) as Record<
    MealType,
    LogEntry[]
  >
  for (const e of entries) meals[e.mealType].push(e)

  const profile = getProfiles(db).find((p) => p.id === profileId)

  return {
    date,
    meals,
    totals: computeTotals(entries),
    goals: {
      calories: profile?.calGoal ?? null,
      protein: profile?.proteinGoal ?? null,
      carbs: profile?.carbsGoal ?? null,
      fat: profile?.fatGoal ?? null
    }
  }
}

export function addLogEntry(db: Database, entry: DraftLogEntry): number {
  const stmt = db.prepare(
    `INSERT INTO food_log
       (profile_id, log_date, meal_type, name, brand, amount, unit,
        base_calories, base_protein, base_carbs, base_fat, barcode, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  )
  stmt.bind([
    entry.profileId,
    entry.date,
    entry.mealType,
    entry.name,
    entry.brand,
    entry.amount,
    entry.unit,
    entry.baseCalories,
    entry.baseProtein,
    entry.baseCarbs,
    entry.baseFat,
    entry.barcode,
    entry.source,
    new Date().toISOString()
  ])
  stmt.step()
  const id = Number(stmt.getAsObject()['id'])
  stmt.free()
  return id
}

export function updateLogEntry(db: Database, id: number, patch: { amount: number }): void {
  db.run('UPDATE food_log SET amount = ? WHERE id = ?', [patch.amount, id])
}

export function deleteLogEntry(db: Database, id: number): void {
  db.run('DELETE FROM food_log WHERE id = ?', [id])
}

/** Returns a previously-scanned barcode product so re-scans work instantly/offline. */
export function getCachedFood(db: Database, barcode: string): FoodItem | null {
  const stmt = db.prepare('SELECT * FROM food_cache WHERE barcode = ?')
  stmt.bind([barcode])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const r = stmt.getAsObject()
  stmt.free()
  return {
    name: String(r['name']),
    brand: nullableStr(r['brand']),
    barcode: String(r['barcode']),
    servingDesc: nullableStr(r['serving_desc']),
    unit: String(r['unit']),
    calories: Number(r['cal_per_unit']),
    protein: Number(r['protein_per_unit']),
    carbs: Number(r['carbs_per_unit']),
    fat: Number(r['fat_per_unit']),
    source: 'barcode'
  }
}

export function upsertCachedFood(db: Database, item: FoodItem): void {
  if (!item.barcode) return
  db.run(
    `INSERT INTO food_cache
       (barcode, name, brand, serving_desc, unit, cal_per_unit, protein_per_unit, carbs_per_unit, fat_per_unit, last_fetched)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(barcode) DO UPDATE SET
       name = excluded.name, brand = excluded.brand, serving_desc = excluded.serving_desc,
       unit = excluded.unit, cal_per_unit = excluded.cal_per_unit,
       protein_per_unit = excluded.protein_per_unit, carbs_per_unit = excluded.carbs_per_unit,
       fat_per_unit = excluded.fat_per_unit, last_fetched = excluded.last_fetched`,
    [
      item.barcode,
      item.name,
      item.brand,
      item.servingDesc,
      item.unit,
      item.calories,
      item.protein,
      item.carbs,
      item.fat,
      new Date().toISOString()
    ]
  )
}
