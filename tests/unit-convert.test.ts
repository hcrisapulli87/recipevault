import { describe, it, expect } from 'vitest'
import {
  metricizeLine,
  metricizeText,
  convertDraftToMetric,
  hasImperialUnits
} from '../src/shared/unit-convert'
import type { DraftRecipe } from '../src/shared/types'

describe('metricizeLine (weights)', () => {
  it('converts oz and lb to sensibly rounded grams', () => {
    expect(metricizeLine('11oz chicken thigh, boneless')).toEqual({
      text: '310 g chicken thigh, boneless',
      changed: true
    })
    expect(metricizeLine('8 ounces cream cheese')).toEqual({
      text: '225 g cream cheese',
      changed: true
    })
    expect(metricizeLine('1 lb ground beef')).toEqual({
      text: '450 g ground beef',
      changed: true
    })
    expect(metricizeLine('2 lbs potatoes')).toEqual({ text: '910 g potatoes', changed: true })
  })
  it('handles fractions and mixed numbers', () => {
    expect(metricizeLine('1/2 lb butter')).toEqual({ text: '225 g butter', changed: true })
    expect(metricizeLine('1 1/2 lb chicken')).toEqual({ text: '680 g chicken', changed: true })
    expect(metricizeLine('½ lb sugar')).toEqual({ text: '225 g sugar', changed: true })
  })
  it('converts both bounds of a range', () => {
    expect(metricizeLine('1-2 lb pork shoulder')).toEqual({
      text: '450–910 g pork shoulder',
      changed: true
    })
  })
  it('leaves metric and cup/spoon lines alone', () => {
    expect(metricizeLine('600g chicken thighs')).toEqual({
      text: '600g chicken thighs',
      changed: false
    })
    expect(metricizeLine('1 cup flour')).toEqual({ text: '1 cup flour', changed: false })
    expect(metricizeLine('2 tbsp olive oil')).toEqual({
      text: '2 tbsp olive oil',
      changed: false
    })
  })
  it('does not mangle words containing oz/lb letters', () => {
    expect(metricizeLine('1 cup mozzarella').changed).toBe(false)
  })
})

describe('metricizeText (temperatures)', () => {
  it('converts °F to °C rounded to the nearest 5', () => {
    expect(metricizeText('Cook at 360°F for 10 min')).toEqual({
      text: 'Cook at 180°C for 10 min',
      changed: 1
    })
    expect(metricizeText('Preheat oven to 425 F.')).toEqual({
      text: 'Preheat oven to 220°C.',
      changed: 1
    })
  })
  it('converts multiple temperatures and leaves °C alone', () => {
    const r = metricizeText('Sear at 450°F, then bake at 350°F. Rest at 60°C.')
    expect(r.text).toBe('Sear at 230°C, then bake at 175°C. Rest at 60°C.')
    expect(r.changed).toBe(2)
  })
  it('is a no-op without Fahrenheit', () => {
    expect(metricizeText('Simmer for 20 minutes')).toEqual({
      text: 'Simmer for 20 minutes',
      changed: 0
    })
  })
})

const draft = (ings: string[], steps: string[]): DraftRecipe => ({
  title: 'T',
  sourceUrl: null,
  imageUrl: null,
  description: '',
  servings: 4,
  prepMin: null,
  cookMin: null,
  totalMin: null,
  ingredients: ings.map((raw, position) => ({
    position,
    raw,
    quantity: null,
    quantityMax: null,
    unit: null,
    name: raw
  })),
  steps: steps.map((text, position) => ({ position, section: null, text })),
  confidence: 'structured'
})

describe('convertDraftToMetric', () => {
  it('converts lines + steps and counts changes', () => {
    const d = draft(['1 lb beef', '600g rice'], ['Cook at 360°F', 'Serve'])
    const out = convertDraftToMetric(d)
    expect(out.measurements).toBe(1)
    expect(out.temps).toBe(1)
    expect(out.draft.ingredients[0].raw).toBe('450 g beef')
    expect(out.draft.ingredients[1].raw).toBe('600g rice')
    expect(out.draft.steps[0].text).toBe('Cook at 180°C')
  })
})

describe('hasImperialUnits', () => {
  it('detects convertible content in ingredients or steps', () => {
    expect(hasImperialUnits(draft(['1 lb beef'], ['Serve']))).toBe(true)
    expect(hasImperialUnits(draft(['600g rice'], ['Cook at 360°F']))).toBe(true)
    expect(hasImperialUnits(draft(['600g rice'], ['Serve']))).toBe(false)
  })
})
