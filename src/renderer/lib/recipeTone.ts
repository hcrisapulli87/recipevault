/** Tone-gradient placeholder palette for recipes without a photo (from the
 *  glass design spec). The hash keeps a recipe's colour stable across renders. */
const TONES = ['#67c9a8', '#f0a35e', '#e58fb1', '#5e9bfd', '#8f7bd8', '#4fc3d9']

export function recipeTone(title: string): string {
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0
  return TONES[h % TONES.length]
}

export function recipeInitial(title: string): string {
  return (title.trim().charAt(0) || '?').toUpperCase()
}
