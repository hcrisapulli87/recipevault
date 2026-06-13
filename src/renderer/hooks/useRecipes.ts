import { useCallback, useEffect, useState } from 'react'
import type { RecipeSummary } from '../../shared/types'

export function useRecipes(): { recipes: RecipeSummary[]; reload: () => void } {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([])

  const reload = useCallback(() => {
    window.api.getRecipes().then(setRecipes)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { recipes, reload }
}
