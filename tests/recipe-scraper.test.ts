import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { extractRecipeFromHtml, parseIsoDuration } from '../src/main/recipe-scraper'

const fix = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf-8')

describe('parseIsoDuration', () => {
  it('parses PT1H30M', () => expect(parseIsoDuration('PT1H30M')).toBe(90))
  it('parses PT45M', () => expect(parseIsoDuration('PT45M')).toBe(45))
  it('parses PT3H', () => expect(parseIsoDuration('PT3H')).toBe(180))
  it('returns null for junk', () => expect(parseIsoDuration('soon')).toBeNull())
  it('returns null for undefined', () => expect(parseIsoDuration(undefined)).toBeNull())
})

describe('extractRecipeFromHtml', () => {
  it('extracts from simple JSON-LD', () => {
    const r = extractRecipeFromHtml(fix('jsonld-simple.html'))
    expect(r).not.toBeNull()
    expect(r!.confidence).toBe('structured')
    expect(r!.title).toBe('Classic Pancakes')
    expect(r!.imageUrl).toBe('https://example.com/images/pancakes.jpg')
    expect(r!.servings).toBe(4)
    expect(r!.prepMin).toBe(15)
    expect(r!.cookMin).toBe(30)
    expect(r!.totalMin).toBe(45)
    expect(r!.ingredients).toHaveLength(3)
    expect(r!.ingredients[0]).toMatchObject({ quantity: 2, unit: 'cup', name: 'flour' })
    expect(r!.steps).toHaveLength(3)
    expect(r!.steps[0].text).toBe('Whisk the dry ingredients together.')
  })

  it('extracts from @graph with sections, ImageObject, and @type array', () => {
    const r = extractRecipeFromHtml(fix('jsonld-graph.html'))
    expect(r).not.toBeNull()
    expect(r!.confidence).toBe('structured')
    expect(r!.title).toBe('Slow-Cooked Ragu')
    expect(r!.imageUrl).toBe('https://example.com/images/ragu.jpg')
    expect(r!.servings).toBe(6)
    expect(r!.totalMin).toBe(200)
    expect(r!.ingredients).toHaveLength(4)
    expect(r!.steps).toHaveLength(4)
    expect(r!.steps[0].section).toBe('Prep')
    expect(r!.steps[2].section).toBe('Cooking')
    // HTML entity decoded
    expect(r!.steps[1].text).toBe('Cut the beef into large chunks & season.')
  })

  it('falls back to heuristics when no JSON-LD', () => {
    const r = extractRecipeFromHtml(fix('no-jsonld.html'))
    expect(r).not.toBeNull()
    expect(r!.confidence).toBe('heuristic')
    expect(r!.title).toBe("Mum's Cottage Pie")
    expect(r!.imageUrl).toBe('https://example.com/images/cottage-pie.jpg')
    expect(r!.ingredients).toHaveLength(4)
    expect(r!.ingredients[0]).toMatchObject({ quantity: 500, unit: 'g', name: 'minced beef' })
    expect(r!.steps).toHaveLength(3)
    expect(r!.steps[2].text).toBe('Top the mince with mash and bake until golden.')
  })

  it('returns null for a page with no recipe', () =>
    expect(extractRecipeFromHtml('<html><body><p>hello</p></body></html>')).toBeNull())
})
