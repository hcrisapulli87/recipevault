import { ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import type { Database } from 'sql.js'
import { IPC } from '../shared/types'
import type { AppSettings, Day, DraftRecipe, MealPlanEntry } from '../shared/types'
import { scaleIngredient } from '../shared/ingredient-parser'
import {
  getRecipes,
  getRecipe,
  saveRecipe,
  deleteRecipe,
  getMealPlan,
  setMeal,
  clearWeek
} from './db'
import { fetchAndExtract, ScrapeError } from './recipe-scraper'
import { writeBotPlan, readBotPlan, mergeBotPlan } from './bot-mealplan-sync'
import { mergeIngredients, groceryTitle } from './grocery-merge'
import { addGroceries, googleStatus, signIn } from './google-tasks'
import { getSettings, setSettings } from './settings'

const BOT_WRITE_WARNING =
  'Could not write to the Discord bot folder — the plan is saved here, but !mealplan won’t see it. Check the folder path in Settings.'

export function registerIpcHandlers(db: Database, persist: () => void): void {
  const titleOf = (id: number): string => getRecipe(db, id)?.title ?? ''

  /** Pull bot-side !setmeal/!clearmeal changes in, persisting any differences. */
  const mealPlanWithBotChanges = (): MealPlanEntry[] => {
    const local = getMealPlan(db)
    const botMap = readBotPlan(getSettings().botFolder)
    if (!botMap) return local
    const merged = mergeBotPlan(local, botMap, titleOf)
    let changed = false
    for (let i = 0; i < merged.length; i++) {
      if (merged[i] !== local[i]) {
        setMeal(db, merged[i].day, merged[i].recipeId, merged[i].freeText)
        changed = true
      }
    }
    if (changed) persist()
    return merged
  }

  /** Export the current plan to the bot's meal_plan.json; non-fatal on failure. */
  const exportPlanToBot = (): string | undefined => {
    try {
      writeBotPlan(getSettings().botFolder, getMealPlan(db), titleOf)
      return undefined
    } catch {
      return BOT_WRITE_WARNING
    }
  }

  // ── recipes ────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_RECIPES, () => getRecipes(db))

  ipcMain.handle(IPC.GET_RECIPE, (_e, id: number) => getRecipe(db, id))

  ipcMain.handle(IPC.SAVE_RECIPE, (_e, draft: DraftRecipe) => {
    const id = saveRecipe(db, draft)
    persist()
    return id
  })

  ipcMain.handle(IPC.DELETE_RECIPE, (_e, id: number) => {
    mealPlanWithBotChanges() // merge bot edits first so the export below can't clobber them
    deleteRecipe(db, id)
    persist()
    exportPlanToBot() // a deleted recipe may have been on the plan
  })

  ipcMain.handle(IPC.SCRAPE_URL, async (_e, url: string) => {
    try {
      return { ok: true, data: await fetchAndExtract(url) }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof ScrapeError ? e.message : 'Something went wrong fetching that page.'
      }
    }
  })

  // ── meal plan ──────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.GET_MEAL_PLAN, () => mealPlanWithBotChanges())

  ipcMain.handle(
    IPC.SET_MEAL,
    (_e, args: { day: Day; recipeId: number | null; freeText: string | null }) => {
      mealPlanWithBotChanges() // merge bot edits first so we don't clobber them
      setMeal(db, args.day, args.recipeId, args.freeText)
      persist()
      return { ok: true, warning: exportPlanToBot() }
    }
  )

  ipcMain.handle(IPC.CLEAR_WEEK, () => {
    clearWeek(db)
    persist()
    return { ok: true, warning: exportPlanToBot() }
  })

  // ── groceries ──────────────────────────────────────────────────────────────

  ipcMain.handle(
    IPC.PREVIEW_GROCERIES,
    (_e, args: { recipeIds: number[]; scales: Record<number, number> }) => {
      const all = args.recipeIds.flatMap((id) => {
        const recipe = getRecipe(db, id)
        if (!recipe) return []
        const factor = args.scales[id] ?? 1
        return recipe.ingredients.map((ing) => scaleIngredient(ing, factor))
      })
      return mergeIngredients(all).map(groceryTitle)
    }
  )

  ipcMain.handle(IPC.SEND_GROCERIES, async (_e, titles: string[]) => {
    try {
      return { ok: true, data: await addGroceries(getSettings().groceriesList, titles) }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Google Tasks request failed.' }
    }
  })

  // ── google / settings ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.GOOGLE_STATUS, () => googleStatus())

  ipcMain.handle(IPC.GOOGLE_SIGN_IN, async () => {
    try {
      await signIn()
      return { ok: true, data: googleStatus() }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Sign-in failed.' }
    }
  })

  ipcMain.handle(IPC.GET_SETTINGS, () => ({
    ...getSettings(),
    botFolderExists: existsSync(getSettings().botFolder)
  }))

  ipcMain.handle(IPC.SET_SETTINGS, (_e, settings: AppSettings) => {
    setSettings(settings)
    return { ...getSettings(), botFolderExists: existsSync(settings.botFolder) }
  })

  ipcMain.handle(IPC.OPEN_EXTERNAL, (_e, url: string) => shell.openExternal(url))
}
