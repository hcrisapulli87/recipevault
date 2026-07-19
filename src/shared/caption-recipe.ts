import { parseIngredient } from './ingredient-parser'
import type { DraftRecipe, RecipeIngredient, RecipeStep } from './types'

const URL_RE = /https?:\/\/[^\s)\]]+/
const INGREDIENTS_HEADER = /^ingredients\b/i
const STEPS_HEADER = /^(how to|method|instructions|directions|steps)\b/i
const NUMBERED = /^(\d+)[.):]\s+(.*)$/
// Lines that are calls-to-action / engagement bait, never titles or content.
const CTA = /follow|comment|link in bio|full recipe|save this|cookbook|pre-?order|tag me|inbox/i
const HASHTAGS = /^#\w/

export function extractFirstUrl(text: string): string | null {
  const m = text.match(URL_RE)
  return m ? m[0].replace(/[.,;!?]+$/, '') : null
}

/** Strip leading bullets: emoji, dashes, dots, arrows — anything before a letter or digit. */
function stripBullet(line: string): string {
  return line.replace(/^[^\p{L}\p{N}]+/u, '').trim()
}

/**
 * Best-effort caption → draft recipe. Returns null when the caption holds no
 * recipe (video-only reels). Confidence is always 'heuristic' — the review
 * form labels it as a best guess.
 */
export function parseCaptionRecipe(caption: string, uploader: string | null): DraftRecipe | null {
  const rawLines = caption.split('\n').map((l) => l.trim())
  const lines = rawLines.map(stripBullet)

  let ingHeader = -1
  let stepsHeader = -1
  for (let i = 0; i < lines.length; i++) {
    if (ingHeader === -1 && INGREDIENTS_HEADER.test(lines[i])) ingHeader = i
    if (stepsHeader === -1 && STEPS_HEADER.test(lines[i])) stepsHeader = i
  }

  // ── ingredients ────────────────────────────────────────────────────────────
  const ingredients: RecipeIngredient[] = []
  const takeIngredient = (i: number): void => {
    const s = lines[i]
    if (!s || s.length > 120 || URL_RE.test(rawLines[i]) || HASHTAGS.test(rawLines[i])) return
    if (s.endsWith(':')) return // section subheader ("Batter:") — keep the list flat
    ingredients.push({ ...parseIngredient(s), position: ingredients.length })
  }
  if (ingHeader !== -1) {
    // Everything under the header until steps begin or hashtags start.
    for (let i = ingHeader + 1; i < lines.length; i++) {
      if (i === stepsHeader || NUMBERED.test(lines[i]) || HASHTAGS.test(rawLines[i])) break
      takeIngredient(i)
    }
  } else {
    // No header: longest run of consecutive bulleted/quantity lines (≥2 with quantities).
    let best: number[] = []
    let run: number[] = []
    const flush = (): void => {
      const q = run.filter((i) => parseIngredient(lines[i]).quantity !== null).length
      if (q >= 2 && run.length > best.length) best = run
      run = []
    }
    for (let i = 0; i < lines.length; i++) {
      const bulleted = lines[i] !== '' && rawLines[i] !== lines[i]
      const hasQty = lines[i] !== '' && parseIngredient(lines[i]).quantity !== null
      if ((hasQty || bulleted) && !NUMBERED.test(lines[i]) && !STEPS_HEADER.test(lines[i])) {
        run.push(i)
      } else {
        flush()
      }
    }
    flush()
    for (const i of best) takeIngredient(i)
  }

  // ── steps: numbered lines, folding unnumbered continuation lines in ────────
  const steps: RecipeStep[] = []
  let current: string | null = null
  const push = (): void => {
    if (current) steps.push({ position: steps.length, section: null, text: current })
    current = null
  }
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(NUMBERED)
    if (m) {
      push()
      current = m[2]
    } else if (current !== null) {
      if (!lines[i] || HASHTAGS.test(rawLines[i])) push()
      else current += ' ' + lines[i]
    }
  }
  push()

  if (ingredients.length === 0 && steps.length === 0) return null

  // ── title: first short, non-CTA, non-macro line before the ingredients ─────
  const stopAt = ingHeader !== -1 ? ingHeader : lines.length
  let title = ''
  for (let i = 0; i < stopAt; i++) {
    const s = lines[i]
    if (!s || s.length > 60 || s.endsWith(':')) continue
    if (CTA.test(s) || /^\w+:\s/.test(s)) continue // engagement bait / "Protein: 42g"
    if (URL_RE.test(rawLines[i]) || HASHTAGS.test(rawLines[i])) continue
    if (parseIngredient(s).quantity !== null) continue
    title = s
    break
  }
  if (!title) {
    const short = uploader?.split('|')[0].trim()
    title = short ? `Instagram recipe — ${short}` : 'Instagram recipe'
  }

  // ── description: first substantial prose line before the ingredients ───────
  let description = ''
  for (let i = 0; i < stopAt; i++) {
    const s = lines[i]
    if (
      s.length >= 40 &&
      !CTA.test(s) &&
      !HASHTAGS.test(rawLines[i]) &&
      !URL_RE.test(rawLines[i])
    ) {
      description = s
      break
    }
  }

  const servingsM = caption.match(/(\d+)\s*servings?/i)

  return {
    title,
    sourceUrl: null, // caller sets the reel URL
    imageUrl: null, // Instagram CDN thumbnails are signed and expire — never hot-link
    description,
    servings: servingsM ? Number(servingsM[1]) : null,
    prepMin: null,
    cookMin: null,
    totalMin: null,
    ingredients,
    steps,
    confidence: 'heuristic'
  }
}
