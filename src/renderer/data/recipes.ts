import { supabase } from './supabase'
import type { DraftRecipe, Recipe, RecipeEstimate, RecipeSummary } from '../../shared/types'

// owner_id is stamped by the column default (auth.uid()) and guarded by RLS, so inserts
// below never set it explicitly. Postgres snake_case ↔ app camelCase is mapped here.

const EST_COLS =
  'servings, est_cal_serve, est_protein_serve, est_carbs_serve, est_fat_serve, est_matched, est_total, est_computed_at'

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

export async function listRecipes(): Promise<RecipeSummary[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select(`id, owner_id, title, image_url, total_min, ${EST_COLS}`)
    .order('title')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    imageUrl: r.image_url,
    totalMin: r.total_min,
    est: mapEst(r)
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
