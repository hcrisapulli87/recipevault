import { scrapeUrl } from './scrape'
import { extractFirstUrl, parseCaptionRecipe } from '../../shared/caption-recipe'
import type { DraftRecipe, IpcResult } from '../../shared/types'

const IG_URL = /^https:\/\/(www\.)?instagram\.com\/(reel|reels|p|tv)\/[A-Za-z0-9_-]+/

export function isInstagramUrl(url: string): boolean {
  return IG_URL.test(url.trim())
}

/**
 * Caption → draft recipe, spec decision order:
 * 1. caption link → existing scraper (structured recipe data wins outright)
 * 2. heuristic caption parse (labelled best-guess by the review form)
 * 3. honest failure (video-only reels)
 * The reel stays `sourceUrl` (it's what was saved); a followed blog link is
 * appended to the description so it isn't lost.
 */
export async function captionToDraft(
  caption: string,
  uploader: string | null,
  reelUrl: string | null
): Promise<IpcResult<DraftRecipe>> {
  const link = extractFirstUrl(caption)
  if (link) {
    const scraped = await scrapeUrl(link)
    if (scraped.ok) {
      const note = `Recipe: ${link}`
      return {
        ok: true,
        data: {
          ...scraped.data,
          sourceUrl: reelUrl ?? scraped.data.sourceUrl,
          description: scraped.data.description ? `${scraped.data.description}\n\n${note}` : note
        }
      }
    }
  }
  const parsed = parseCaptionRecipe(caption, uploader)
  if (parsed) return { ok: true, data: { ...parsed, sourceUrl: reelUrl } }
  return {
    ok: false,
    message:
      'No recipe found in the caption — this one probably only exists in the video. You can enter it manually.'
  }
}

/** Desktop only: fetch via the local yt-dlp bridge, then parse. */
export async function importInstagramDesktop(url: string): Promise<IpcResult<DraftRecipe>> {
  const post = await window.api!.fetchInstagram(url)
  if (!post.ok) return post
  return captionToDraft(post.data.caption, post.data.uploader, url)
}
