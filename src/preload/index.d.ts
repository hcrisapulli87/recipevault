import type {
  AppSettings,
  Day,
  DraftRecipe,
  IpcResult,
  MealPlanEntry,
  Recipe,
  RecipeSummary
} from '../shared/types'

export interface SettingsWithStatus extends AppSettings {
  botFolderExists: boolean
}

export interface GoogleStatus {
  credentials: boolean
  signedIn: boolean
}

declare global {
  interface Window {
    api: {
      getRecipes: () => Promise<RecipeSummary[]>
      getRecipe: (id: number) => Promise<Recipe | null>
      saveRecipe: (draft: DraftRecipe) => Promise<number>
      deleteRecipe: (id: number) => Promise<void>
      scrapeUrl: (url: string) => Promise<IpcResult<DraftRecipe>>
      getMealPlan: () => Promise<MealPlanEntry[]>
      setMeal: (args: {
        day: Day
        recipeId: number | null
        freeText: string | null
      }) => Promise<{ ok: true; warning?: string }>
      clearWeek: () => Promise<{ ok: true; warning?: string }>
      previewGroceries: (args: {
        recipeIds: number[]
        scales: Record<number, number>
      }) => Promise<string[]>
      sendGroceries: (titles: string[]) => Promise<IpcResult<{ added: number; skipped: number }>>
      googleStatus: () => Promise<GoogleStatus>
      googleSignIn: () => Promise<IpcResult<GoogleStatus>>
      getSettings: () => Promise<SettingsWithStatus>
      setSettings: (settings: AppSettings) => Promise<SettingsWithStatus>
      openExternal: (url: string) => Promise<void>
    }
  }
}

export {}
