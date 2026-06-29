import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { AppSettings, Day, DraftLogEntry, DraftRecipe, ProfileGoals } from '../shared/types'

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
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  // macro tracker
  getProfiles: () => ipcRenderer.invoke(IPC.GET_PROFILES),
  addProfile: (name: string) => ipcRenderer.invoke(IPC.ADD_PROFILE, name),
  updateProfile: (args: { id: number; name?: string; goals?: ProfileGoals }) =>
    ipcRenderer.invoke(IPC.UPDATE_PROFILE, args),
  deleteProfile: (id: number) => ipcRenderer.invoke(IPC.DELETE_PROFILE, id),
  getDailyLog: (args: { profileId: number; date: string }) =>
    ipcRenderer.invoke(IPC.GET_DAILY_LOG, args),
  addLogEntry: (entry: DraftLogEntry) => ipcRenderer.invoke(IPC.ADD_LOG_ENTRY, entry),
  updateLogEntry: (args: { id: number; amount: number }) =>
    ipcRenderer.invoke(IPC.UPDATE_LOG_ENTRY, args),
  deleteLogEntry: (id: number) => ipcRenderer.invoke(IPC.DELETE_LOG_ENTRY, id),
  searchFoods: (query: string) => ipcRenderer.invoke(IPC.SEARCH_FOODS, query),
  lookupBarcode: (barcode: string) => ipcRenderer.invoke(IPC.LOOKUP_BARCODE, barcode)
})
