import type { Day, DraftRecipe, MealPlanEntry, Recipe, RecipeSummary } from '../shared/types'

declare global {
  interface Window {
    api: {
      getRecipes: () => Promise<RecipeSummary[]>
      getRecipe: (id: number) => Promise<Recipe | null>
      saveRecipe: (draft: DraftRecipe) => Promise<number>
      deleteRecipe: (id: number) => Promise<void>
      getMealPlan: () => Promise<MealPlanEntry[]>
      setMeal: (args: {
        day: Day
        recipeId: number | null
        freeText: string | null
      }) => Promise<void>
      clearWeek: () => Promise<void>
      openExternal: (url: string) => Promise<void>
    }
  }
}

export {}
