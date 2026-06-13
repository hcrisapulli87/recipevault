import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { AppSettings, Day, DraftRecipe } from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  getRecipes: () => ipcRenderer.invoke(IPC.GET_RECIPES),
  getRecipe: (id: number) => ipcRenderer.invoke(IPC.GET_RECIPE, id),
  saveRecipe: (draft: DraftRecipe) => ipcRenderer.invoke(IPC.SAVE_RECIPE, draft),
  deleteRecipe: (id: number) => ipcRenderer.invoke(IPC.DELETE_RECIPE, id),
  scrapeUrl: (url: string) => ipcRenderer.invoke(IPC.SCRAPE_URL, url),
  getMealPlan: () => ipcRenderer.invoke(IPC.GET_MEAL_PLAN),
  setMeal: (args: { day: Day; recipeId: number | null; freeText: string | null }) =>
    ipcRenderer.invoke(IPC.SET_MEAL, args),
  clearWeek: () => ipcRenderer.invoke(IPC.CLEAR_WEEK),
  previewGroceries: (args: { recipeIds: number[]; scales: Record<number, number> }) =>
    ipcRenderer.invoke(IPC.PREVIEW_GROCERIES, args),
  sendGroceries: (titles: string[]) => ipcRenderer.invoke(IPC.SEND_GROCERIES, titles),
  googleStatus: () => ipcRenderer.invoke(IPC.GOOGLE_STATUS),
  googleSignIn: () => ipcRenderer.invoke(IPC.GOOGLE_SIGN_IN),
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  setSettings: (settings: AppSettings) => ipcRenderer.invoke(IPC.SET_SETTINGS, settings),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url)
})
