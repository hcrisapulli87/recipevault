import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isInstagramUrl, captionToDraft } from '../src/renderer/data/instagram'
import type { DraftRecipe, IpcResult } from '../src/shared/types'

const scrape = vi.hoisted(() => ({
  result: { ok: false, message: 'nope' } as IpcResult<DraftRecipe>,
  calls: [] as string[]
}))

vi.mock('../src/renderer/data/scrape', () => ({
  scrapeUrl: async (url: string) => {
    scrape.calls.push(url)
    return scrape.result
  }
}))

const REEL = 'https://www.instagram.com/reel/ABC123/'

function structuredDraft(): DraftRecipe {
  return {
    title: 'Chicken Katsu',
    sourceUrl: 'https://cjeatsrecipes.com/chicken-katsu/',
    imageUrl: 'https://cjeatsrecipes.com/img.jpg',
    description: 'Crispy katsu.',
    servings: 4,
    prepMin: null,
    cookMin: null,
    totalMin: 30,
    ingredients: [],
    steps: [],
    confidence: 'structured'
  }
}

beforeEach(() => {
  scrape.result = { ok: false, message: 'nope' }
  scrape.calls = []
})

describe('isInstagramUrl', () => {
  it('matches reels and posts, rejects other sites', () => {
    expect(isInstagramUrl(REEL)).toBe(true)
    expect(isInstagramUrl('https://instagram.com/p/XYZ/?utm_source=x')).toBe(true)
    expect(isInstagramUrl('https://www.bbcgoodfood.com/recipes/katsu')).toBe(false)
  })
})

describe('captionToDraft', () => {
  it('follows a caption link through the scraper; reel becomes sourceUrl, blog kept in description', async () => {
    scrape.result = { ok: true, data: structuredDraft() }
    const res = await captionToDraft(
      'Get the recipe: https://cjeatsrecipes.com/chicken-katsu/ #food',
      'Chris Joe',
      REEL
    )
    expect(scrape.calls).toEqual(['https://cjeatsrecipes.com/chicken-katsu/'])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.sourceUrl).toBe(REEL)
      expect(res.data.description).toContain('https://cjeatsrecipes.com/chicken-katsu/')
      expect(res.data.confidence).toBe('structured')
    }
  })

  it('falls back to the heuristic caption parse when the link scrape fails', async () => {
    const caption = `Popcorn chicken!\n\nIngredients:\n- 600g chicken thighs\n- 1 tbsp oil\n\nhttps://linktr.ee/someone`
    const res = await captionToDraft(caption, 'Aimee', REEL)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.confidence).toBe('heuristic')
      expect(res.data.sourceUrl).toBe(REEL)
      expect(res.data.ingredients.length).toBe(2)
    }
  })

  it('reports honestly when the caption has no recipe at all', async () => {
    const res = await captionToDraft('time to open a shop 🥪', 'Fraser', REEL)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toMatch(/only exists in the video/i)
  })
})
