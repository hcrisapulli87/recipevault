import { supabase } from './supabase'
import type { DraftRecipe, Recipe, RecipeSummary } from '../../shared/types'

// owner_id is stamped by the column default (auth.uid()) and guarded by RLS, so inserts
// below never set it explicitly. Postgres snake_case ↔ app camelCase is mapped here.

export async function listRecipes(): Promise<RecipeSummary[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, image_url, total_min')
    .order('title')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    imageUrl: r.image_url,
    totalMin: r.total_min
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
    title: r.title,
    sourceUrl: r.source_url,
    imageUrl: r.image_url,
    description: r.description ?? '',
    servings: r.servings,
    prepMin: r.prep_min,
    cookMin: r.cook_min,
    totalMin: r.total_min,
    createdAt: r.created_at,
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
    if (ie) throw new Error(ie.message)
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
    if (se) throw new Error(se.message)
  }
  return id
}

export async function deleteRecipe(id: number): Promise<void> {
  // ingredients/steps cascade via the FK; meal_plan.recipe_id is ON DELETE SET NULL.
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
