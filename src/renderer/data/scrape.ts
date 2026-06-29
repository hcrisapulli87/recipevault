import type { DraftRecipe, IpcResult } from '../../shared/types'

// On the PWA this defaults to the same-origin function; the Electron build can point
// VITE_SCRAPE_URL at the deployed endpoint.
const SCRAPE_ENDPOINT = import.meta.env.VITE_SCRAPE_URL ?? '/api/scrape'

export async function scrapeUrl(url: string): Promise<IpcResult<DraftRecipe>> {
  try {
    const res = await fetch(`${SCRAPE_ENDPOINT}?url=${encodeURIComponent(url)}`)
    return (await res.json()) as IpcResult<DraftRecipe>
  } catch {
    return { ok: false, message: 'Could not reach the recipe scraper. Check your connection.' }
  }
}
