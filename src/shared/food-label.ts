import type { FoodItem } from './types'

/** A search-result row's two lines: the bold title and the dimmed detail beneath it. */
export interface FoodLabel {
  /** What the food IS, in plain English. */
  title: string
  /** Everything the title didn't say, " · "-joined. May be empty. */
  detail: string
}

/** Sentence case: capitalise the first letter, leave the rest (AFCD has "pH", "UHT"). */
function sentenceCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

function join(parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join(' · ')
}

/**
 * A readable label for one search result.
 *
 * Branded products already carry a marketing name written for humans, so it is used
 * verbatim. Generic foods come from the AFCD, which names a food as a taxonomy path
 * ("Egg, chicken, whole, hard-boiled") — a database key, not a label — so the head is
 * promoted to the title and everything else is demoted to the detail line.
 */
export function foodLabel(item: FoodItem): FoodLabel {
  if (item.brand) {
    return { title: item.name, detail: join([item.brand, item.servingDesc]) }
  }

  const segments = item.name
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const head = segments[0] ?? item.name
  const tail = segments.slice(1)

  return { title: sentenceCase(head), detail: join([...tail, item.servingDesc]) }
}
