import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import { DAYS } from '../shared/types'
import type { MealPlanEntry } from '../shared/types'

// Shared-file contract with the Discord household bot: <botFolder>/meal_plan.json
// holds {"monday": "Meal name", ...} — exactly the format the bot's meal_planner.py uses.
// The bot re-reads the file on each command, so writes here show up in !mealplan live.

const FILE_NAME = 'meal_plan.json'

function exportString(entry: MealPlanEntry, titleOf: (id: number) => string): string {
  if (entry.recipeId !== null) return titleOf(entry.recipeId)
  return entry.freeText ?? ''
}

export function writeBotPlan(
  botFolder: string,
  entries: MealPlanEntry[],
  titleOf: (id: number) => string
): void {
  const map: Record<string, string> = {}
  for (const day of DAYS) {
    const entry = entries.find((e) => e.day === day)
    map[day] = entry ? exportString(entry, titleOf) : ''
  }
  // atomic write: the bot may read at any moment
  const target = join(botFolder, FILE_NAME)
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(map, null, 2))
  renameSync(tmp, target)
}

export function readBotPlan(botFolder: string): Record<string, string> | null {
  const target = join(botFolder, FILE_NAME)
  if (!existsSync(target)) return null
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

export function mergeBotPlan(
  local: MealPlanEntry[],
  botMap: Record<string, string>,
  titleOf: (id: number) => string
): MealPlanEntry[] {
  return local.map((entry) => {
    const botValue = botMap[entry.day]
    if (botValue === undefined) return entry
    if (botValue === exportString(entry, titleOf)) return entry
    // bot side changed this day (e.g. !setmeal / !clearmeal) — bot wins, as free text
    return { ...entry, recipeId: null, freeText: botValue.trim() === '' ? null : botValue }
  })
}
