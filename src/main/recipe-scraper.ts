import type { DraftRecipe, RecipeIngredient, RecipeStep } from '../shared/types'
import { parseIngredient } from '../shared/ingredient-parser'

// Strips a recipe page down to ingredients + steps.
// Pass 1: schema.org/Recipe JSON-LD (most recipe sites embed it for search cards).
// Pass 2: heuristic scan of microdata/class names for older blogs.
// Regex/string scanning only — no DOM dependency, mirroring the nanoblock scraper approach.

export class ScrapeError extends Error {}

// ── small text utilities ──────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseIsoDuration(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = v.match(/^P(?:[\d.]+D)?T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?/)
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  return Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0))
}

// ── JSON-LD pass ──────────────────────────────────────────────────────────────

type JsonObject = Record<string, unknown>

function isRecipeNode(node: unknown): node is JsonObject {
  if (typeof node !== 'object' || node === null) return false
  const t = (node as JsonObject)['@type']
  if (typeof t === 'string') return t === 'Recipe'
  if (Array.isArray(t)) return t.includes('Recipe')
  return false
}

function findRecipeNode(node: unknown): JsonObject | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item)
      if (found) return found
    }
    return null
  }
  if (typeof node !== 'object' || node === null) return null
  if (isRecipeNode(node)) return node
  const graph = (node as JsonObject)['@graph']
  if (graph) return findRecipeNode(graph)
  return null
}

function asText(v: unknown): string {
  if (typeof v === 'string') return stripTags(v)
  if (typeof v === 'object' && v !== null) {
    const o = v as JsonObject
    if (typeof o['text'] === 'string') return stripTags(o['text'])
    if (typeof o['name'] === 'string') return stripTags(o['name'])
  }
  return ''
}

function firstImage(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.length ? firstImage(v[0]) : null
  if (typeof v === 'object' && v !== null) {
    const url = (v as JsonObject)['url']
    if (typeof url === 'string') return url
  }
  return null
}

function parseYield(v: unknown): number | null {
  if (typeof v === 'number') return Math.round(v)
  if (Array.isArray(v)) return v.length ? parseYield(v[0]) : null
  if (typeof v === 'string') {
    const m = v.match(/\d+/)
    return m ? Number(m[0]) : null
  }
  return null
}

function extractSteps(instructions: unknown): RecipeStep[] {
  const steps: RecipeStep[] = []
  const walk = (node: unknown, section: string | null): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, section)
      return
    }
    if (typeof node === 'string') {
      const text = stripTags(node)
      if (text) steps.push({ position: steps.length, section, text })
      return
    }
    if (typeof node !== 'object' || node === null) return
    const o = node as JsonObject
    if (o['@type'] === 'HowToSection') {
      const name = typeof o['name'] === 'string' ? stripTags(o['name']) : section
      walk(o['itemListElement'], name)
      return
    }
    const text = asText(o)
    if (text) steps.push({ position: steps.length, section, text })
  }
  walk(instructions, null)
  return steps
}

function ingredientsFromStrings(lines: string[]): RecipeIngredient[] {
  return lines
    .map((l) => stripTags(l))
    .filter((l) => l.length > 0)
    .map((l, position) => ({ position, ...parseIngredient(l) }))
}

function extractFromJsonLd(html: string): DraftRecipe | null {
  const scripts = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )
  for (const m of scripts) {
    let parsed: unknown
    try {
      parsed = JSON.parse(m[1])
    } catch {
      continue
    }
    const recipe = findRecipeNode(parsed)
    if (!recipe) continue

    const ingredientLines = Array.isArray(recipe['recipeIngredient'])
      ? (recipe['recipeIngredient'] as unknown[]).map((i) => (typeof i === 'string' ? i : ''))
      : []
    const ingredients = ingredientsFromStrings(ingredientLines)
    const steps = extractSteps(recipe['recipeInstructions'])
    if (ingredients.length === 0 && steps.length === 0) continue

    return {
      title: asText(recipe['name']) || 'Untitled recipe',
      sourceUrl: null,
      imageUrl: firstImage(recipe['image']),
      description: asText(recipe['description']),
      servings: parseYield(recipe['recipeYield']),
      prepMin: parseIsoDuration(recipe['prepTime']),
      cookMin: parseIsoDuration(recipe['cookTime']),
      totalMin: parseIsoDuration(recipe['totalTime']),
      ingredients,
      steps,
      confidence: 'structured'
    }
  }
  return null
}

// ── heuristic pass ────────────────────────────────────────────────────────────

function metaContent(html: string, property: string): string | null {
  const content = `content=(?:"([^"]*)"|'([^']*)')`
  const m = html.match(new RegExp(`<meta[^>]*property=["']${property}["'][^>]*${content}`, 'i'))
  if (m) return decodeEntities(m[1] ?? m[2])
  const rev = html.match(new RegExp(`<meta[^>]*${content}[^>]*property=["']${property}["']`, 'i'))
  return rev ? decodeEntities(rev[1] ?? rev[2]) : null
}

function listItems(blockHtml: string): string[] {
  return [...blockHtml.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((t) => t.length > 0)
}

function extractHeuristic(html: string): DraftRecipe | null {
  // ingredients: microdata first, then class-name matching
  let ingredientLines = [
    ...html.matchAll(/<[^>]*itemprop=["']recipeIngredient["'][^>]*>([\s\S]*?)<\//gi)
  ]
    .map((m) => stripTags(m[1]))
    .filter((t) => t.length > 0)

  if (ingredientLines.length === 0) {
    const block = html.match(
      /<(?:div|section|ul)[^>]*class=["'][^"']*ingredient[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|ul)>/i
    )
    if (block) ingredientLines = listItems(block[1].includes('<li') ? block[1] : block[0])
  }

  // steps: first <ol> after an instructions-ish heading, then class matching
  let stepTexts: string[] = []
  const headed = html.match(
    /<h[1-6][^>]*>[^<]*(?:instructions|method|directions)[^<]*<\/h[1-6]>[\s\S]*?<ol[^>]*>([\s\S]*?)<\/ol>/i
  )
  if (headed) stepTexts = listItems(headed[1])
  if (stepTexts.length === 0) {
    const block = html.match(
      /<(?:div|section|ol)[^>]*class=["'][^"']*(?:instruction|method|direction|step)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|ol)>/i
    )
    if (block) stepTexts = listItems(block[0])
  }

  if (ingredientLines.length === 0 && stepTexts.length === 0) return null

  const title =
    metaContent(html, 'og:title') ??
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? 'Untitled recipe')

  return {
    title: stripTags(title),
    sourceUrl: null,
    imageUrl: metaContent(html, 'og:image'),
    description: '',
    servings: null,
    prepMin: null,
    cookMin: null,
    totalMin: null,
    ingredients: ingredientsFromStrings(ingredientLines),
    steps: stepTexts.map((text, position) => ({ position, section: null, text })),
    confidence: 'heuristic'
  }
}

// ── public API ────────────────────────────────────────────────────────────────

export function extractRecipeFromHtml(html: string): DraftRecipe | null {
  return extractFromJsonLd(html) ?? extractHeuristic(html)
}

export async function fetchAndExtract(url: string): Promise<DraftRecipe> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml'
      }
    })
  } catch {
    throw new ScrapeError('Could not reach that site. Check the URL and your connection.')
  }
  if (!res.ok) throw new ScrapeError(`The site refused the request (HTTP ${res.status}).`)
  const draft = extractRecipeFromHtml(await res.text())
  if (!draft) throw new ScrapeError('No recipe found on that page. You can enter it manually.')
  draft.sourceUrl = url
  return draft
}
