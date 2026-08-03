import dinners from './catalog/dinners.json'
import dinnersAmericas from './catalog/dinners-americas.json'
import lunches from './catalog/lunches.json'
import breakfasts from './catalog/breakfasts.json'
import snacks from './catalog/snacks.json'
import type { Cuisine, DietTag, Effort, MealType, Reheat } from '../types'

/**
 * The seeded recipe pool the week generator plans from.
 *
 * Split across files by meal role rather than kept in one list: the catalog grows every
 * time a recipe is added, and a single 200-entry file is neither reviewable in a diff nor
 * pleasant to edit. Order within the array carries no meaning — the generator shuffles.
 */
export interface CatalogRecipe {
  /** Stable identity. The seeder upserts on this, so never rename a shipped slug. */
  slug: string
  title: string
  cuisine: Cuisine
  dietTags: DietTag[]
  mealSlots: MealType[]
  effort: Effort
  /** Fridge life in days; 0 = eat fresh. The leftover chain never reaches further. */
  keepsDays: number
  batchFriendly: boolean
  reheat: Reheat
  servings: number
  prepMin: number
  cookMin: number
  description: string
  /** Raw lines, parsed at seed time by the same parser the URL scraper uses. */
  ingredients: string[]
  steps: string[]
}

export const CATALOG_RECIPES: CatalogRecipe[] = [
  ...dinners,
  ...dinnersAmericas,
  ...lunches,
  ...breakfasts,
  ...snacks
] as CatalogRecipe[]
