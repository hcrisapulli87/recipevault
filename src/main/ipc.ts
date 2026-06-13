import { ipcMain, shell } from 'electron'
import type { Database } from 'sql.js'
import { IPC } from '../shared/types'
import type { Day, DraftRecipe } from '../shared/types'
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

export function registerIpcHandlers(db: Database): void {
  ipcMain.handle(IPC.GET_RECIPES, () => getRecipes(db))

  ipcMain.handle(IPC.GET_RECIPE, (_e, id: number) => getRecipe(db, id))

  ipcMain.handle(IPC.SAVE_RECIPE, (_e, draft: DraftRecipe) => saveRecipe(db, draft))

  ipcMain.handle(IPC.DELETE_RECIPE, (_e, id: number) => deleteRecipe(db, id))

  ipcMain.handle(IPC.GET_MEAL_PLAN, () => getMealPlan(db))

  ipcMain.handle(
    IPC.SET_MEAL,
    (_e, args: { day: Day; recipeId: number | null; freeText: string | null }) =>
      setMeal(db, args.day, args.recipeId, args.freeText)
  )

  ipcMain.handle(IPC.CLEAR_WEEK, () => clearWeek(db))

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

  ipcMain.handle(IPC.OPEN_EXTERNAL, (_e, url: string) => shell.openExternal(url))
}
