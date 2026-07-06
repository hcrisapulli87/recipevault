import { describe, it, expect } from 'vitest'
import { extractFirstUrl, parseCaptionRecipe } from '../src/shared/caption-recipe'

// Real captions from the 2026-07-06 feasibility spike (trimmed).
const FULL_RECIPE_CAPTION = `⇩ Full Recipe 🍗 ⇩

Macros per 1 meal prep:
Protein: 42g
Calories: 573

Ingredients per 2 servings (makes 2 meal preps):

Chicken:
- 11oz chicken thigh, boneless, skinless, raw
- 1/2 tsp salt
- 3/4 cup Panko Breadcrumbs

Batter:
- 1 egg
- 1/4 cup flour
- 1.5 tbsp water

How to make it yourself:
1. Chop your cabbage into small pieces
2. Season your chicken thighs with salt and pepper.
3. Pour panko breadcrumbs on a plate. Fully dip the chicken thighs into the batter,
place it on top of the panko breadcrumbs and mix until fully coated.
4. Cook for 360°F for 10 min then flip & cook for another 7-10 minutes.

📩 Save this chicken katsu meal prep recipe to make for later!

#highprotein #mealprep`

const EMOJI_BULLET_CAPTION = `Follow for more!

You're not going to stick to plain chicken and rice forever… so make fat loss food that actually tastes good 👀🍗

This low calorie popcorn chicken is crispy, high protein and stupidly easy to make!

Ingredients:
🍗 600g chicken thighs (sliced)
🫒 1 tbsp oil
🌽 50g cornflour
🧂 Salt & pepper

🔥 Air fry for 20 mins`

const LINK_ONLY_CAPTION = `I had loads of Chicken Katsu in Hawaii but everytime I make my recipe at home I'm reminded of how incredible it is!

Comment "CJ Recipe" for the full recipe with all of my KEY tips sent straight to your inbox!

https://cjeatsrecipes.com/chicken-katsu/

#chicken #easyrecipes`

const NO_RECIPE_CAPTION = `I think it might be time to open a shop 🥪🤠`

describe('extractFirstUrl', () => {
  it('finds the first link and trims trailing punctuation', () => {
    expect(extractFirstUrl(LINK_ONLY_CAPTION)).toBe('https://cjeatsrecipes.com/chicken-katsu/')
    expect(extractFirstUrl('see https://example.com/recipe. Enjoy!')).toBe(
      'https://example.com/recipe'
    )
  })
  it('returns null when there is no link', () => {
    expect(extractFirstUrl(NO_RECIPE_CAPTION)).toBeNull()
  })
})

describe('parseCaptionRecipe', () => {
  it('parses a full caption recipe: header ingredients, numbered steps, servings', () => {
    const d = parseCaptionRecipe(FULL_RECIPE_CAPTION, 'Joe Chu')
    expect(d).not.toBeNull()
    expect(d!.confidence).toBe('heuristic')
    expect(d!.servings).toBe(2)
    expect(d!.imageUrl).toBeNull()
    // Section subheaders ("Chicken:", "Batter:") are skipped; macro lines are not ingredients.
    const names = d!.ingredients.map((i) => i.raw)
    expect(names).toContain('11oz chicken thigh, boneless, skinless, raw')
    expect(names).toContain('1 egg')
    expect(names).not.toContain('Chicken:')
    expect(names.some((n) => /protein/i.test(n))).toBe(false)
    // A quantity actually parsed
    const salt = d!.ingredients.find((i) => /salt/.test(i.raw) && i.quantity !== null)
    expect(salt?.quantity).toBe(0.5)
    expect(salt?.unit).toBe('tsp')
    // Steps: numbered, wrapped continuation folded into step 3
    expect(d!.steps).toHaveLength(4)
    expect(d!.steps[2].text).toMatch(/mix until fully coated/)
    // Junk title lines (CTA / macros) skipped → uploader fallback
    expect(d!.title).toBe('Instagram recipe — Joe Chu')
  })

  it('parses emoji-bulleted ingredients under an Ingredients header', () => {
    const d = parseCaptionRecipe(EMOJI_BULLET_CAPTION, 'Aimee Witkin | Online Coach')
    expect(d).not.toBeNull()
    const raws = d!.ingredients.map((i) => i.raw)
    expect(raws).toContain('600g chicken thighs (sliced)')
    expect(raws).toContain('Salt & pepper')
    const chicken = d!.ingredients.find((i) => i.raw.startsWith('600g'))
    expect(chicken?.quantity).toBe(600)
    expect(chicken?.unit).toBe('g')
    // Uploader fallback truncates at the "|"
    expect(d!.title).toBe('Instagram recipe — Aimee Witkin')
    // Long prose line becomes the description
    expect(d!.description).toMatch(/plain chicken and rice/)
  })

  it('returns null when the caption has no recipe', () => {
    expect(parseCaptionRecipe(NO_RECIPE_CAPTION, 'Fraser')).toBeNull()
    expect(parseCaptionRecipe(LINK_ONLY_CAPTION, 'Chris Joe')).toBeNull()
  })
})
