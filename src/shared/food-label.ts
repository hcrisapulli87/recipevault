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
 * How the food was prepared. Fronted in the title ("Raw egg", "Hard-boiled egg") because
 * that is the difference the reader is choosing between — every AFCD food appears in
 * several of these forms and the raw name buried the distinction at the end of a
 * five-part string.
 *
 * Ordered longest-phrase-first so "deep fried" is matched before "fried" and
 * "hard-boiled" before "boiled". Deliberately absent: "no added fat", "commercial",
 * "homemade", "as purchased" — those describe the sourcing, not the food.
 */
const PREP = [
  'deep fried',
  'stir-fried',
  'hard-boiled',
  'microwaved',
  'casseroled',
  'scrambled',
  'uncooked',
  'poached',
  'roasted',
  'steamed',
  'toasted',
  'grilled',
  'smoked',
  'boiled',
  'canned',
  'dried',
  'fried',
  'fresh',
  'baked',
  'raw'
]

/** Match `phrase` at the start of `segment`, returning what's left of the segment. */
function matchLeading(segment: string, phrase: string): string | null {
  const s = segment.toLowerCase()
  if (s === phrase) return ''
  if (s.startsWith(`${phrase} `)) return segment.slice(phrase.length + 1).trim()
  return null
}

interface Pick {
  /** The lexicon word that was matched, for the title. */
  word: string
  /** Index of the segment it came from. */
  index: number
  /** What remained of that segment, for the detail. '' when fully consumed. */
  rest: string
}

/** First unclaimed segment whose leading words are in `lexicon`, or null. */
function pickFrom(tail: string[], lexicon: string[], taken: Set<number>): Pick | null {
  for (let i = 0; i < tail.length; i++) {
    if (taken.has(i)) continue
    for (const word of lexicon) {
      const rest = matchLeading(tail[i], word)
      if (rest !== null) return { word, index: i, rest }
    }
  }
  return null
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

  const taken = new Set<number>()
  const leftovers = new Map<number, string>()
  const prep = pickFrom(tail, PREP, taken)
  if (prep) {
    taken.add(prep.index)
    leftovers.set(prep.index, prep.rest)
  }

  const title = [prep?.word, head.toLowerCase()].filter(Boolean).join(' ')

  // A claimed segment contributes only its unmatched remainder — "canned in pear juice"
  // gives "canned" to the title and "in pear juice" to the detail.
  const rest = tail.flatMap((seg, i) => {
    if (!taken.has(i)) return [seg]
    const leftover = leftovers.get(i) ?? ''
    return leftover ? [leftover] : []
  })

  return { title: sentenceCase(title), detail: join([...rest, item.servingDesc]) }
}
