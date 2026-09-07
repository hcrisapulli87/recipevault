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
 * List order is priority order (see pickFrom), which buys two things at once:
 *   · a longer phrase is matched before the shorter one it contains — "deep fried"
 *     before "fried", "hard-boiled" before "boiled";
 *   · a cooking method beats a preservation word beats a raw-state word, whatever
 *     order the AFCD listed them in. "Capsicum, red, fresh, fried" is a FRIED capsicum;
 *     scanning left to right would have titled it "Fresh red capsicum".
 *
 * Deliberately absent: "no added fat", "commercial", "homemade", "as purchased" —
 * those describe the sourcing, not the food.
 */
const PREP = [
  // cooked
  'deep fried',
  'stir-fried',
  'hard-boiled',
  'microwaved',
  'casseroled',
  'scrambled',
  'poached',
  'roasted',
  'steamed',
  'toasted',
  'grilled',
  'boiled',
  'fried',
  'baked',
  // preserved
  'smoked',
  'canned',
  'dried',
  // as-is
  'uncooked',
  'fresh',
  'raw'
]

/**
 * Qualifiers English puts BEFORE the noun. "Capsicum, red" is a red capsicum, never a
 * "capsicum red" — placing these after the head produces titles that read as typos.
 */
const PREFIX_MODIFIER = [
  'regular fat',
  'reduced fat',
  'wholemeal',
  'savoury',
  'brown',
  'green',
  'plain',
  'sweet',
  'white',
  'red'
]

/**
 * Which part of the animal or plant. These follow the head ("egg yolk", "chicken thigh")
 * and matter enormously to the macros — the yolk is 313 kcal/100 g against the white's
 * 47 — so they belong in the title, not the detail line.
 *
 * "white" appears here and in PREFIX_MODIFIER; parts are picked first, so the egg white
 * is claimed as a part while "Wine, white" still reaches the modifier lexicon.
 */
const PART = [
  'white (albumen)',
  'albumen',
  'fillet',
  'breast',
  'flesh',
  'steak',
  'thigh',
  'mince',
  'chips',
  'yolk',
  'seed',
  'skin',
  'leg'
]

/** AFCD writes the egg white as "white (albumen)"; the parenthetical is for scientists. */
const PART_TITLE: Record<string, string> = { 'white (albumen)': 'white', albumen: 'white' }

/**
 * Heads that name a CATEGORY rather than a food. The AFCD files the specific food as the
 * next segment ("Nut, peanut", "Fish, eel", "Cheese, edam").
 *
 * `oil` is deliberately absent: "Oil, olive" would need the segment placed BEFORE the
 * head to read correctly, which is the modifier lexicon's job, not this rule's.
 */
const CATEGORY_HEAD = new Set([
  'nut',
  'fish',
  'bread',
  'cheese',
  'sauce',
  'biscuit',
  'bar',
  'noodle',
  'seed',
  'herb',
  'spice'
])

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

/**
 * Best match for `lexicon` among the unclaimed segments, or null.
 *
 * The lexicon is walked in its own order rather than the segments' — the list encodes
 * which word makes the better title, and the AFCD's segment order does not.
 *
 * `partial` says whether a word may be taken from the FRONT of a longer segment. A
 * preparation may: "canned in pear juice" is a canned peach. A modifier may not:
 * "Pasta, white wheat flour & egg" describes the flour, and titling it "White pasta"
 * asserts something about the pasta that the AFCD never said.
 */
function pickFrom(
  tail: string[],
  lexicon: string[],
  taken: Set<number>,
  partial: boolean
): Pick | null {
  for (const word of lexicon) {
    for (let i = 0; i < tail.length; i++) {
      if (taken.has(i)) continue
      const rest = matchLeading(tail[i], word)
      if (rest === null) continue
      if (rest !== '' && !partial) continue
      return { word, index: i, rest }
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
  const picks: (Pick | null)[] = []
  for (const [lexicon, partial] of [
    [PREP, true],
    [PART, false],
    [PREFIX_MODIFIER, false]
  ] as [string[], boolean][]) {
    const pick = pickFrom(tail, lexicon, taken, partial)
    picks.push(pick)
    if (pick) {
      taken.add(pick.index)
      leftovers.set(pick.index, pick.rest)
    }
  }
  const [prep, part, modifier] = picks

  // A head that names a CATEGORY rather than a food answers the wrong question — every
  // nut in the database would be titled "nut" — so the specific segment the AFCD files
  // beneath it takes over. Single-word only: "Pasta, white wheat flour & egg" describes
  // the pasta, it isn't a name for it.
  let effectiveHead = head
  if (CATEGORY_HEAD.has(head.toLowerCase())) {
    const i = tail.findIndex((seg, idx) => !taken.has(idx) && !seg.includes(' '))
    if (i !== -1) {
      effectiveHead = tail[i]
      taken.add(i)
      leftovers.set(i, '')
    }
  }

  const title = [
    prep?.word,
    modifier?.word,
    effectiveHead.toLowerCase(),
    part ? (PART_TITLE[part.word] ?? part.word) : undefined
  ]
    .filter(Boolean)
    .join(' ')

  // A claimed segment contributes only its unmatched remainder — "canned in pear juice"
  // gives "canned" to the title and "in pear juice" to the detail.
  const rest = tail.flatMap((seg, i) => {
    if (!taken.has(i)) return [seg]
    const leftover = leftovers.get(i) ?? ''
    return leftover ? [leftover] : []
  })

  return { title: sentenceCase(title), detail: join([...rest, item.servingDesc]) }
}
