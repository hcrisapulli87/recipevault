export interface ParsedIngredient {
  raw: string
  quantity: number | null
  quantityMax: number | null // upper bound for ranges like "1-2"
  unit: string | null
  name: string
}

export interface RecipeIngredient extends ParsedIngredient {
  position: number
}

export interface RecipeStep {
  position: number
  section: string | null
  text: string
}

export interface Recipe {
  id: number
  title: string
  sourceUrl: string | null
  imageUrl: string | null
  description: string
  servings: number | null
  prepMin: number | null
  cookMin: number | null
  totalMin: number | null
  createdAt: string
  ingredients: RecipeIngredient[]
  steps: RecipeStep[]
}

export interface RecipeSummary {
  id: number
  title: string
  imageUrl: string | null
  totalMin: number | null
}

export type ScrapeConfidence = 'structured' | 'heuristic' | 'manual'

export type DraftRecipe = Omit<Recipe, 'id' | 'createdAt'> & { confidence: ScrapeConfidence }

export type Day = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

export const DAYS: Day[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
]

export interface MealPlanEntry {
  day: Day
  recipeId: number | null
  freeText: string | null
}

export interface MergedGroceryItem {
  name: string
  parts: { quantity: number; unit: string | null }[]
}

export interface AppSettings {
  botFolder: string
  groceriesList: string
}

export type IpcResult<T> = { ok: true; data: T; warning?: string } | { ok: false; message: string }

export const IPC = {
  GET_RECIPES: 'get-recipes',
  GET_RECIPE: 'get-recipe',
  SAVE_RECIPE: 'save-recipe',
  DELETE_RECIPE: 'delete-recipe',
  SCRAPE_URL: 'scrape-url',
  GET_MEAL_PLAN: 'get-meal-plan',
  SET_MEAL: 'set-meal',
  CLEAR_WEEK: 'clear-week',
  PREVIEW_GROCERIES: 'preview-groceries',
  SEND_GROCERIES: 'send-groceries',
  GOOGLE_STATUS: 'google-status',
  GOOGLE_SIGN_IN: 'google-sign-in',
  GET_SETTINGS: 'get-settings',
  SET_SETTINGS: 'set-settings',
  OPEN_EXTERNAL: 'open-external'
} as const
