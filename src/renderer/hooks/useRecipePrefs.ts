import { useCallback, useEffect, useState } from 'react'
import type { RecipePref } from '../../shared/types'
import { listRecipePrefs, setFavourite } from '../data/recipePrefs'
import { onTableChange } from '../data/realtime'

/** Household favourites + notes, live. `toggleFavourite` flips the heart optimistically
 *  so the tap feels instant; the realtime refetch then settles the true state. */
export function useRecipePrefs(meId: string | null): {
  prefs: RecipePref[]
  isFavourite: (recipeId: number) => boolean
  toggleFavourite: (recipeId: number) => Promise<void>
  reload: () => void
} {
  const [prefs, setPrefs] = useState<RecipePref[]>([])

  const reload = useCallback(() => {
    // A failed read (offline) keeps the last known hearts rather than blanking them.
    listRecipePrefs().then(setPrefs, () => undefined)
  }, [])

  useEffect(() => {
    reload()
    return onTableChange(['recipe_prefs'], reload)
  }, [reload])

  const isFavourite = useCallback(
    (recipeId: number) =>
      prefs.some((p) => p.ownerId === meId && p.recipeId === recipeId && p.favourite),
    [prefs, meId]
  )

  const toggleFavourite = useCallback(
    async (recipeId: number) => {
      if (!meId) return
      const next = !isFavourite(recipeId)
      setPrefs((cur) => {
        const has = cur.some((p) => p.ownerId === meId && p.recipeId === recipeId)
        return has
          ? cur.map((p) =>
              p.ownerId === meId && p.recipeId === recipeId ? { ...p, favourite: next } : p
            )
          : [...cur, { ownerId: meId, recipeId, favourite: next, notes: '' }]
      })
      try {
        await setFavourite(recipeId, next)
      } catch {
        // offline, or recipe_prefs not migrated yet — the reload below flips the heart back
      }
      reload()
    },
    [meId, isFavourite, reload]
  )

  return { prefs, isFavourite, toggleFavourite, reload }
}
