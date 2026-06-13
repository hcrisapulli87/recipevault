import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { Day, DraftRecipe } from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  getRecipes: () => ipcRenderer.invoke(IPC.GET_RECIPES),
  getRecipe: (id: number) => ipcRenderer.invoke(IPC.GET_RECIPE, id),
  saveRecipe: (draft: DraftRecipe) => ipcRenderer.invoke(IPC.SAVE_RECIPE, draft),
  deleteRecipe: (id: number) => ipcRenderer.invoke(IPC.DELETE_RECIPE, id),
  getMealPlan: () => ipcRenderer.invoke(IPC.GET_MEAL_PLAN),
  setMeal: (args: { day: Day; recipeId: number | null; freeText: string | null }) =>
    ipcRenderer.invoke(IPC.SET_MEAL, args),
  clearWeek: () => ipcRenderer.invoke(IPC.CLEAR_WEEK),
  scrapeUrl: (url: string) => ipcRenderer.invoke(IPC.SCRAPE_URL, url),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url)
})
