import { useCallback, useEffect, useState } from 'react'
import type { RecipeSummary } from '../../shared/types'
import { listRecipes } from '../data/recipes'

export function useRecipes(): { recipes: RecipeSummary[]; reload: () => void } {
  const [recipes, setRecipes] = useState<RecipeSummary[]>([])

  const reload = useCallback(() => {
    listRecipes().then(setRecipes)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { recipes, reload }
}
