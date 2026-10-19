import { supabase } from './supabase'
import { myId } from './users'
import type { RecipePref } from '../../shared/types'

// Favourites and notes live in their own household-readable, owner-writable table, so
// you can heart a catalog recipe or note the partner's import without write access to
// the recipe itself. A missing row means "not favourited, no notes".

/** Every household member's prefs. The library needs mine (hearts, the Favourites filter)
 *  and the detail page shows the partner's note read-only, so one query serves both. */
export async function listRecipePrefs(): Promise<RecipePref[]> {
  const { data, error } = await supabase
    .from('recipe_prefs')
    .select('owner_id, recipe_id, favourite, notes')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    ownerId: r.owner_id,
    recipeId: r.recipe_id,
    favourite: r.favourite,
    notes: r.notes ?? ''
  }))
}

/** Upsert one field of my own row. `owner_id` is written explicitly, not left to the
 *  column default, because it is part of the conflict target. Only the named field is
 *  sent, so hearting a recipe never overwrites a note written on another device. */
async function upsertPref(
  recipeId: number,
  patch: { favourite: boolean } | { notes: string }
): Promise<void> {
  const ownerId = await myId()
  const { error } = await supabase
    .from('recipe_prefs')
    .upsert(
      { owner_id: ownerId, recipe_id: recipeId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'owner_id,recipe_id' }
    )
  if (error) throw new Error(error.message)
}

export function setFavourite(recipeId: number, favourite: boolean): Promise<void> {
  return upsertPref(recipeId, { favourite })
}

export function setRecipeNotes(recipeId: number, notes: string): Promise<void> {
  return upsertPref(recipeId, { notes: notes.trim() })
}
