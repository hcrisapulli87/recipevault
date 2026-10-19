import { describe, it, expect } from 'vitest'
import { splitStepTimers, formatCountdown } from '../src/shared/step-timers'
import type { StepPart } from '../src/shared/step-timers'
import { CATALOG_RECIPES } from '../src/shared/data/catalog-recipes'

const timers = (text: string): { seconds: number; label: string; text: string }[] =>
  splitStepTimers(text)
    .filter((p): p is Extract<StepPart, { kind: 'timer' }> => p.kind === 'timer')
    .map(({ seconds, label, text: t }) => ({ seconds, label, text: t }))

describe('splitStepTimers', () => {
  it('finds a plain duration and keeps the surrounding text intact', () => {
    const parts = splitStepTimers('Add the tomatoes and simmer 4 minutes until thickened')
    expect(parts).toEqual([
      { kind: 'text', text: 'Add the tomatoes and simmer ' },
      { kind: 'timer', text: '4 minutes', seconds: 240, label: '4 min' },
      { kind: 'text', text: ' until thickened' }
    ])
    expect(parts.map((p) => p.text).join('')).toBe(
      'Add the tomatoes and simmer 4 minutes until thickened'
    )
  })

  it.each([
    ['Fry the garlic for 30 seconds', 30, '30 sec'],
    ['Blend 60 seconds until smooth', 60, '1 min'],
    ['Simmer uncovered for 1 hour', 3600, '1 hr'],
    ['Cover and cook 3 hours', 10800, '3 hr'],
    ['Roast for 1 hour 30 minutes', 5400, '1 hr 30 min'],
    ['Roast for 1 hr and 15 min', 4500, '1 hr 15 min'],
    ['Bake for 1½ hours', 5400, '1 hr 30 min'],
    ['Bake for 1.5 hours', 5400, '1 hr 30 min'],
    ['Leave for half an hour', 1800, '30 min'],
    ['Cook for a minute more', 60, '1 min'],
    ['Rest for an hour', 3600, '1 hr'],
    ['Leave two minutes', 120, '2 min'],
    ['Bake 25 mins', 1500, '25 min'],
    ['Grill 8 min', 480, '8 min'],
    ['Rest 15 minutes before slicing', 900, '15 min'],
    ['Simmer uncovered another hour', 3600, '1 hr']
  ])('%s → %i s', (text, seconds, label) => {
    expect(timers(text)).toMatchObject([{ seconds, label }])
  })

  it('starts a range on its lower bound but labels the whole range', () => {
    expect(timers('Simmer 10-15 minutes')).toMatchObject([{ seconds: 600, label: '10–15 min' }])
    expect(timers('Simmer 10 to 15 minutes')).toMatchObject([{ seconds: 600, label: '10–15 min' }])
    expect(timers('Braise 2–3 hours')).toMatchObject([{ seconds: 7200, label: '2–3 hr' }])
  })

  it('finds every timer in a step', () => {
    expect(timers('Bake 45 minutes, glaze with the rest, and bake a further 15 minutes')).toEqual([
      { seconds: 2700, label: '45 min', text: '45 minutes' },
      { seconds: 900, label: '15 min', text: '15 minutes' }
    ])
  })

  it('ignores a duration that adjusts the packet time', () => {
    expect(timers('Cook the macaroni two minutes short of the packet time')).toEqual([])
    expect(timers('Cook 2 minutes less than the packet says')).toEqual([])
  })

  it('leaves steps without a duration as one text run', () => {
    expect(splitStepTimers('Season well and serve')).toEqual([
      { kind: 'text', text: 'Season well and serve' }
    ])
    expect(timers('Bake at 190°C until golden')).toEqual([])
    expect(timers('Add 400 g canned tomatoes')).toEqual([])
  })

  it('reads every catalog step without losing text or producing a nonsense timer', () => {
    let found = 0
    for (const recipe of CATALOG_RECIPES) {
      for (const step of recipe.steps) {
        const parts = splitStepTimers(step)
        expect(parts.map((p) => p.text).join('')).toBe(step)
        for (const p of parts) {
          if (p.kind !== 'timer') continue
          found++
          expect(p.seconds).toBeGreaterThanOrEqual(5)
          expect(p.seconds).toBeLessThanOrEqual(24 * 3600)
        }
      }
    }
    // The catalog is written with explicit times; most of its ~300 mentions should land.
    expect(found).toBeGreaterThan(250)
  })
})

describe('formatCountdown', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [65, '1:05'],
    [600, '10:00'],
    [3725, '1:02:05'],
    [59.2, '1:00']
  ])('%d → %s', (s, out) => {
    expect(formatCountdown(s)).toBe(out)
  })
})
