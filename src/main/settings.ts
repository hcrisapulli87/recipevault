import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '../shared/types'

const DEFAULTS: AppSettings = {
  botFolder: 'C:\\Users\\Harrison Crisapulli\\Documents\\claudecode\\discord-household-bot',
  groceriesList: 'Groceries',
  activeProfileId: 1
}

let userDataPath = ''

export function initSettings(userData: string): void {
  userDataPath = userData
}

function settingsPath(): string {
  return join(userDataPath, 'settings.json')
}

export function getSettings(): AppSettings {
  if (!existsSync(settingsPath())) return { ...DEFAULTS }
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(settingsPath(), 'utf-8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setSettings(settings: AppSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2))
}
