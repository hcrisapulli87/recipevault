import type { RecipeIngredient } from './types'

// Which ingredients a method step uses, so Cooking Mode can show "In this step: 1 onion,
// 2 cloves garlic" under the step instead of sending the cook back to the list. Matches
// on words already in the step text — no extra data, works on every recipe.

/** Words that describe an ingredient rather than name it; never matched on alone. */
const DESCRIPTORS = new Set([
  'canned',
  'tinned',
  'fresh',
  'frozen',
  'dried',
  'large',
  'small',
  'medium',
  'brown',
  'red',
  'white',
  'green',
  'yellow',
  'baby',
  'extra',
  'virgin',
  'ground',
  'smoked',
  'boneless',
  'skinless',
  'plain',
  'light',
  'raw',
  'cooked',
  'unsalted',
  'salted',
  'finely',
  'roughly',
  'whole',
  'wholemeal',
  'mixed',
  'chopped',
  'sliced',
  'diced',
  'grated',
  'of'
])

/** Heads that name a cut or a form, where the step usually says the first word instead:
 *  "chicken thigh fillets" is "the chicken", "garlic cloves" is "the garlic". */
const CUT_HEADS = new Set([
  'fillet',
  'breast',
  'thigh',
  'clove',
  'leaf',
  'leave',
  'sprig',
  'stalk',
  'piece',
  'slice',
  'rasher',
  'steak',
  'chop',
  'can',
  'tin',
  'bunch',
  'head',
  'stick'
])

function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && /(oes|ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whole-word match that also accepts the plural ("onion" finds "onions"). */
function mentions(text: string, phrase: string): boolean {
  const words = phrase.split(' ').map(escapeRe)
  const last = words.pop()
  const re = new RegExp(`\\b${[...words, `${last}(?:s|es)?`].join('\\s+')}\\b`, 'i')
  return re.test(text)
}

/** The words worth matching for one ingredient, most specific first. */
export function ingredientKeys(name: string): string[] {
  const core = name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(',')[0]
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map(singular)
  const named = core.filter((w) => !DESCRIPTORS.has(w))
  if (named.length === 0) return []
  const keys = [named.join(' ')]
  const head = named[named.length - 1]
  if (named.length > 1) keys.push(head)
  if (CUT_HEADS.has(head) && named.length > 1) keys.push(named[0])
  return [...new Set(keys)].filter((k) => k.length >= 3)
}

/**
 * Ingredients the step mentions, in recipe order. When two ingredients match on the same
 * head word ("onion") and one of them matched on more words ("spring onion"), the less
 * specific one is dropped — the step was talking about the specific one.
 */
export function ingredientsForStep(
  stepText: string,
  ingredients: RecipeIngredient[]
): RecipeIngredient[] {
  const hits = ingredients
    .map((ing) => {
      const matched = ingredientKeys(ing.name).find((k) => mentions(stepText, k)) ?? null
      return { ing, matched }
    })
    .filter((h): h is { ing: RecipeIngredient; matched: string } => h.matched !== null)

  const words = (k: string): string[] => k.split(' ')
  const headOf = (k: string): string => words(k)[words(k).length - 1]
  return hits
    .filter(
      (h) =>
        !hits.some(
          (o) =>
            o !== h &&
            headOf(o.matched) === headOf(h.matched) &&
            words(o.matched).length > words(h.matched).length
        )
    )
    .map((h) => h.ing)
}
