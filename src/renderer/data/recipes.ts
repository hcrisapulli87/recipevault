import { supabase } from './supabase'
import type {
  Cuisine,
  DietTag,
  DraftRecipe,
  Effort,
  MealType,
  Recipe,
  RecipeEstimate,
  RecipeMeta,
  RecipeSummary,
  Reheat
} from '../../shared/types'

// owner_id is stamped by the column default (auth.uid()) and guarded by RLS, so inserts
// below never set it explicitly. Postgres snake_case ↔ app camelCase is mapped here.

const EST_COLS =
  'servings, est_cal_serve, est_protein_serve, est_carbs_serve, est_fat_serve, est_matched, est_total, est_computed_at'

const META_COLS =
  'is_catalog, catalog_slug, cuisine, diet_tags, meal_slots, effort, keeps_days, batch_friendly, reheat'

/** Planner metadata row → app shape. Personal imports hold the column defaults, which
 *  map to "untagged" and so stay invisible to the week generator. */
function mapMeta(r: {
  is_catalog?: boolean | null
  catalog_slug?: string | null
  cuisine?: string | null
  diet_tags?: string[] | null
  meal_slots?: string[] | null
  effort?: string | null
  keeps_days?: number | null
  batch_friendly?: boolean | null
  reheat?: string | null
}): RecipeMeta {
  return {
    isCatalog: r.is_catalog ?? false,
    catalogSlug: r.catalog_slug ?? null,
    cuisine: (r.cuisine as Cuisine | null) ?? null,
    dietTags: (r.diet_tags ?? []) as DietTag[],
    mealSlots: (r.meal_slots ?? []) as MealType[],
    effort: (r.effort as Effort | null) ?? null,
    keepsDays: r.keeps_days ?? 0,
    batchFriendly: r.batch_friendly ?? false,
    reheat: (r.reheat as Reheat | null) ?? null
  }
}

function mapEst(r: {
  est_cal_serve: number | null
  est_protein_serve: number | null
  est_carbs_serve: number | null
  est_fat_serve: number | null
  est_matched: number | null
  est_total: number | null
  est_computed_at: string | null
  servings?: number | null
}): RecipeEstimate | null {
  if (r.est_computed_at === null || r.est_cal_serve === null) return null
  return {
    calories: r.est_cal_serve,
    protein: r.est_protein_serve ?? 0,
    carbs: r.est_carbs_serve ?? 0,
    fat: r.est_fat_serve ?? 0,
    matched: r.est_matched ?? 0,
    total: r.est_total ?? 0,
    assumedServings: (r.servings ?? null) === null
  }
}

/**
 * Recipe summaries. `catalog` filters the seeded pool in or out:
 *   undefined → everything (what the planner and generator want)
 *   false     → only the household's own imports (the Library's default "Mine" tab)
 *   true      → only the seeded catalog
 */
export async function listRecipes(opts: { catalog?: boolean } = {}): Promise<RecipeSummary[]> {
  let query = supabase
    .from('recipes')
    .select(`id, owner_id, title, image_url, total_min, ${EST_COLS}, ${META_COLS}`)
  if (opts.catalog !== undefined) query = query.eq('is_catalog', opts.catalog)

  const { data, error } = await query.order('title')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    imageUrl: r.image_url,
    totalMin: r.total_min,
    servings: r.servings,
    est: mapEst(r),
    ...mapMeta(r)
  }))
}

export async function getRecipe(id: number): Promise<Recipe | null> {
  const { data: r, error } = await supabase.from('recipes').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!r) return null

  const [ingRes, stepRes] = await Promise.all([
    supabase
      .from('ingredients')
      .select('position, raw_text, quantity, quantity_max, unit, name')
      .eq('recipe_id', id)
      .order('position'),
    supabase.from('steps').select('position, section, text').eq('recipe_id', id).order('position')
  ])
  if (ingRes.error) throw new Error(ingRes.error.message)
  if (stepRes.error) throw new Error(stepRes.error.message)

  return {
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    sourceUrl: r.source_url,
    imageUrl: r.image_url,
    description: r.description ?? '',
    servings: r.servings,
    prepMin: r.prep_min,
    cookMin: r.cook_min,
    totalMin: r.total_min,
    createdAt: r.created_at,
    est: mapEst(r),
    ...mapMeta(r),
    ingredients: (ingRes.data ?? []).map((i) => ({
      position: i.position,
      raw: i.raw_text,
      quantity: i.quantity,
      quantityMax: i.quantity_max,
      unit: i.unit,
      name: i.name
    })),
    steps: (stepRes.data ?? []).map((s) => ({
      position: s.position,
      section: s.section,
      text: s.text
    }))
  }
}

export async function saveRecipe(draft: DraftRecipe): Promise<number> {
  const { data, error } = await supabase
    .from('recipes')
    .insert({
      title: draft.title,
      source_url: draft.sourceUrl,
      image_url: draft.imageUrl,
      description: draft.description,
      servings: draft.servings,
      prep_min: draft.prepMin,
      cook_min: draft.cookMin,
      total_min: draft.totalMin
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const id = data.id as number

  // Three separate inserts, not a transaction — if children fail, remove the recipe row
  // (cascades) so a retry never leaves a title-only orphan in the library.
  const childError = async (message: string): Promise<never> => {
    await supabase.from('recipes').delete().eq('id', id)
    throw new Error(message)
  }
  if (draft.ingredients.length > 0) {
    const { error: ie } = await supabase.from('ingredients').insert(
      draft.ingredients.map((i) => ({
        recipe_id: id,
        position: i.position,
        raw_text: i.raw,
        quantity: i.quantity,
        quantity_max: i.quantityMax,
        unit: i.unit,
        name: i.name
      }))
    )
    if (ie) await childError(ie.message)
  }
  if (draft.steps.length > 0) {
    const { error: se } = await supabase.from('steps').insert(
      draft.steps.map((s) => ({
        recipe_id: id,
        position: s.position,
        section: s.section,
        text: s.text
      }))
    )
    if (se) await childError(se.message)
  }
  return id
}

/**
 * Copy a catalog recipe into the signed-in user's own library so it can be edited and
 * deleted like an import. Planner metadata (cuisine, diet, fridge life) is carried over —
 * losing it would make the copy invisible to the week generator — but `catalog_slug` is
 * dropped so the seeder never overwrites the personal copy, and `is_catalog` goes false
 * so it shows under "Mine". The macro estimate is copied too rather than recomputed:
 * the seeder already did that work against the same food table.
 */
export async function copyToLibrary(id: number): Promise<number> {
  const src = await getRecipe(id)
  if (!src) throw new Error('Recipe not found')

  const { data, error } = await supabase
    .from('recipes')
    .insert({
      title: src.title,
      source_url: src.sourceUrl,
      image_url: src.imageUrl,
      description: src.description,
      servings: src.servings,
      prep_min: src.prepMin,
      cook_min: src.cookMin,
      total_min: src.totalMin,
      is_catalog: false,
      catalog_slug: null,
      cuisine: src.cuisine,
      diet_tags: src.dietTags,
      meal_slots: src.mealSlots,
      effort: src.effort,
      keeps_days: src.keepsDays,
      batch_friendly: src.batchFriendly,
      reheat: src.reheat,
      est_cal_serve: src.est?.calories ?? null,
      est_protein_serve: src.est?.protein ?? null,
      est_carbs_serve: src.est?.carbs ?? null,
      est_fat_serve: src.est?.fat ?? null,
      est_matched: src.est?.matched ?? null,
      est_total: src.est?.total ?? null,
      est_computed_at: src.est ? new Date().toISOString() : null
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const newId = data.id as number

  // Same rollback discipline as saveRecipe: a title-only orphan is worse than no copy.
  const childError = async (message: string): Promise<never> => {
    await supabase.from('recipes').delete().eq('id', newId)
    throw new Error(message)
  }
  if (src.ingredients.length > 0) {
    const { error: ie } = await supabase.from('ingredients').insert(
      src.ingredients.map((i) => ({
        recipe_id: newId,
        position: i.position,
        raw_text: i.raw,
        quantity: i.quantity,
        quantity_max: i.quantityMax,
        unit: i.unit,
        name: i.name
      }))
    )
    if (ie) await childError(ie.message)
  }
  if (src.steps.length > 0) {
    const { error: se } = await supabase.from('steps').insert(
      src.steps.map((s) => ({
        recipe_id: newId,
        position: s.position,
        section: s.section,
        text: s.text
      }))
    )
    if (se) await childError(se.message)
  }
  return newId
}

export async function deleteRecipe(id: number): Promise<void> {
  // The FK nulls meal_plan.recipe_id, but meal_text (the denormalised label the Discord
  // bot reads) would keep the deleted title — clear it first, while recipe_id still
  // points at this recipe. free_text stays: it's a deliberate manual entry.
  const { error: me } = await supabase
    .from('meal_plan')
    .update({ meal_text: null })
    .eq('recipe_id', id)
  if (me) throw new Error(me.message)

  // ingredients/steps cascade via the FK; meal_plan.recipe_id is ON DELETE SET NULL.
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
