import type { Database } from 'sql.js'
import { DAYS } from '../shared/types'
import type {
  Day,
  DraftRecipe,
  MealPlanEntry,
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
  `)
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
