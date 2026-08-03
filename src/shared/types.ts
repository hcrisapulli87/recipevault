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

// ── catalog metadata ──────────────────────────────────────────────────────────

/** Cuisine buckets the seeded catalog is authored against. */
export type Cuisine =
  | 'asian'
  | 'american'
  | 'italian'
  | 'greek'
  | 'mexican'
  | 'spanish'
  | 'indian'
  | 'middle-eastern'
  | 'other'

export const CUISINES: Cuisine[] = [
  'asian',
  'american',
  'italian',
  'greek',
  'mexican',
  'spanish',
  'indian',
  'middle-eastern',
  'other'
]

export const CUISINE_LABEL: Record<Cuisine, string> = {
  asian: 'Asian',
  american: 'American',
  italian: 'Italian',
  greek: 'Greek',
  mexican: 'Mexican',
  spanish: 'Spanish',
  indian: 'Indian',
  'middle-eastern': 'Middle Eastern',
  other: 'Other'
}

/** Diet filters. Only these two are authored in the first iteration; the column is an
 *  array so adding vegetarian/Mediterranean later is additive, not a migration. */
export type DietTag = 'balanced' | 'high-protein'

export const DIET_TAGS: DietTag[] = ['balanced', 'high-protein']

export const DIET_LABEL: Record<DietTag, string> = {
  balanced: 'Balanced',
  'high-protein': 'High protein'
}

/** How much work a recipe is. `minimal` is the "Banana with Honey" class — assembly, not
 *  cooking — and is what the generator reaches for to fill breakfasts and snack slots. */
export type Effort = 'minimal' | 'easy' | 'medium'

export const EFFORTS: Effort[] = ['minimal', 'easy', 'medium']

export const EFFORT_LABEL: Record<Effort, string> = {
  minimal: 'Minimal',
  easy: 'Easy',
  medium: 'Medium'
}

/** How leftovers of this recipe are eaten. `fresh-only` is never chained by the generator. */
export type Reheat = 'microwave' | 'oven' | 'cold' | 'fresh-only'

/** Planner-facing metadata. Personal imports carry the defaults (no cuisine, no tags,
 *  keepsDays 0) and so are simply invisible to the generator until tagged. */
export interface RecipeMeta {
  isCatalog: boolean
  catalogSlug: string | null
  cuisine: Cuisine | null
  dietTags: DietTag[]
  mealSlots: MealType[]
  effort: Effort | null
  /** Fridge life in days. 0 = eat fresh; the leftover chain never reaches further. */
  keepsDays: number
  batchFriendly: boolean
  reheat: Reheat | null
}

export interface Recipe extends RecipeMeta {
  id: number
  ownerId: string
  title: string
  sourceUrl: string | null
  imageUrl: string | null
  description: string
  servings: number | null
  prepMin: number | null
  cookMin: number | null
  totalMin: number | null
  createdAt: string
  est: RecipeEstimate | null
  ingredients: RecipeIngredient[]
  steps: RecipeStep[]
}

export interface RecipeSummary extends RecipeMeta {
  id: number
  ownerId: string
  title: string
  imageUrl: string | null
  totalMin: number | null
  servings: number | null
  est: RecipeEstimate | null
}

/** Per-100g macro values used by the estimator. */
export interface Per100g {
  calories: number
  protein: number
  carbs: number
  fat: number
}

/** Stored per-serving macro estimate summary (best guess from parsed ingredients). */
export interface RecipeEstimate {
  calories: number
  protein: number
  carbs: number
  fat: number
  matched: number
  total: number
  assumedServings: boolean
}

export type ScrapeConfidence = 'structured' | 'heuristic' | 'manual'

// Drafts have no estimate yet — it's computed right after save. Catalog metadata is
// excluded too: a scraped/reviewed recipe is a personal import and takes the column
// defaults (not catalog, no cuisine, keepsDays 0), so the review form never has to
// invent planner tags. The seeder writes those columns directly instead.
export type DraftRecipe = Omit<
  Recipe,
  'id' | 'ownerId' | 'createdAt' | 'est' | keyof RecipeMeta
> & {
  confidence: ScrapeConfidence
}

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

/** Planner slots: the tracker's meal types minus snack. Labels come from MEAL_LABEL. */
export type PlanMeal = 'breakfast' | 'lunch' | 'dinner'

export const PLAN_MEALS: PlanMeal[] = ['breakfast', 'lunch', 'dinner']

/**
 * One planner slot. A LEFTOVER slot carries the same `recipeId` as its cook night —
 * that's what lets groceries count the batch once and the tracker log identical macros.
 * `cookDay` is the label source ("Leftovers from Tue"); `servingsPlanned` lives on the
 * cook night and drives grocery scaling.
 */
export interface MealPlanEntry {
  day: Day
  meal: PlanMeal
  recipeId: number | null
  freeText: string | null
  isLeftover: boolean
  cookDay: Day | null
  servingsPlanned: number | null
}

export const DAY_SHORT: Record<Day, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun'
}

export interface MergedGroceryItem {
  name: string
  parts: { quantity: number; unit: string | null }[]
}

export interface GroceryItem {
  id: string
  name: string
  qtyText: string | null
  checked: boolean
  sortOrder: number
}

// ── instagram import ──────────────────────────────────────────────────────────

/** What the desktop yt-dlp fetch returns for a reel. */
export interface InstagramPost {
  caption: string
  uploader: string | null
}

export type ImportQueueStatus = 'pending' | 'fetched' | 'failed'

/** One phone-submitted reel waiting for (or processed by) the desktop fetcher. */
export interface ImportQueueItem {
  id: number
  ownerId: string
  url: string
  status: ImportQueueStatus
  caption: string | null
  uploader: string | null
  error: string | null
  createdAt: string
}

// ── macro / meal tracker ──────────────────────────────────────────────────────

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack'
}

export interface Profile {
  id: number
  name: string
  calGoal: number | null
  proteinGoal: number | null
  carbsGoal: number | null
  fatGoal: number | null
}

export type ProfileGoals = Pick<Profile, 'calGoal' | 'proteinGoal' | 'carbsGoal' | 'fatGoal'>

/** A known serving size: a human label plus its weight in grams. */
export interface FoodMeasure {
  desc: string
  grams: number
}

/** A food's macros expressed per ONE unit (one serving, or per 100 g). */
export interface FoodItem {
  name: string
  brand: string | null
  barcode: string | null
  servingDesc: string | null
  unit: string // 'serving' | '100g'
  calories: number
  protein: number
  carbs: number
  fat: number
  source: 'staple' | 'search' | 'barcode' | 'manual' | 'plan' | 'recent'
  /** Canonical per-100 g macros when known — lets the Add flow log in grams OR by
   *  serving regardless of `unit`. Absent for legacy/cache items with no basis. */
  per100g?: Per100g
  /** Real serving sizes for the grams⇄serving picker; empty/absent → grams only. */
  measures?: FoodMeasure[]
}

/** A logged item. Macros are stored per-unit; the day's total is base_* × amount. */
export interface LogEntry {
  id: number
  mealType: MealType
  name: string
  brand: string | null
  amount: number
  unit: string
  baseCalories: number
  baseProtein: number
  baseCarbs: number
  baseFat: number
  barcode: string | null
  source: string
}

export type DraftLogEntry = Omit<LogEntry, 'id'> & { profileId: number; date: string }

export interface DailyTotals {
  calories: number
  protein: number
  carbs: number
  fat: number
}

export interface DailyLog {
  date: string
  meals: Record<MealType, LogEntry[]>
  totals: DailyTotals
  goals: {
    calories: number | null
    protein: number | null
    carbs: number | null
    fat: number | null
  }
}

export interface AppSettings {
  botFolder: string
  groceriesList: string
  activeProfileId: number
}

export type IpcResult<T> = { ok: true; data: T; warning?: string } | { ok: false; message: string }

export const IPC = {
  GET_RECIPES: 'get-recipes',
  GET_RECIPE: 'get-recipe',
  SAVE_RECIPE: 'save-recipe',
  DELETE_RECIPE: 'delete-recipe',
  SCRAPE_URL: 'scrape-url',
  INSTAGRAM_FETCH: 'instagram-fetch',
  GET_MEAL_PLAN: 'get-meal-plan',
  SET_MEAL: 'set-meal',
  CLEAR_WEEK: 'clear-week',
  PREVIEW_GROCERIES: 'preview-groceries',
  SEND_GROCERIES: 'send-groceries',
  GOOGLE_STATUS: 'google-status',
  GOOGLE_SIGN_IN: 'google-sign-in',
  GET_SETTINGS: 'get-settings',
  SET_SETTINGS: 'set-settings',
  OPEN_EXTERNAL: 'open-external',
  GET_PROFILES: 'get-profiles',
  ADD_PROFILE: 'add-profile',
  UPDATE_PROFILE: 'update-profile',
  DELETE_PROFILE: 'delete-profile',
  GET_DAILY_LOG: 'get-daily-log',
  ADD_LOG_ENTRY: 'add-log-entry',
  UPDATE_LOG_ENTRY: 'update-log-entry',
  DELETE_LOG_ENTRY: 'delete-log-entry',
  SEARCH_FOODS: 'search-foods',
  LOOKUP_BARCODE: 'lookup-barcode'
} as const
