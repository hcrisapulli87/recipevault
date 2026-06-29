// Vercel Node serverless function: GET /api/scrape?url=… → { ok, data } | { ok:false, message }.
// Recipe scraping must run server-side — a browser can't fetch third-party recipe pages (CORS).
// Because this endpoint is public + unauthenticated, every fetched URL (and every redirect hop)
// is SSRF-checked, the response is size/time-capped, and upstream failures collapse to one
// generic message so the endpoint can't be used as a port/host scanner.
import { assertPublicHttpUrl } from './_ssrf'
import { extractRecipeFromHtml } from '../src/shared/recipe-scraper'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const MAX_BYTES = 2_000_000
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 10_000

// Comma-separated allowlist, e.g. "https://recipevault.vercel.app,https://www.recipevault.app".
// Same-origin PWA requests need no CORS header; the Electron build's origin can be added here.
const ALLOWED_ORIGINS = (process.env.SCRAPE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function setCors(req: any, res: any): void {
  const origin = req.headers?.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
}

async function safeFetchHtml(initialUrl: string): Promise<string | null> {
  let target = (await assertPublicHttpUrl(initialUrl)).toString()
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(target, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }
      })
    } finally {
      clearTimeout(timer)
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return null
      target = (await assertPublicHttpUrl(new URL(loc, target).toString())).toString()
      continue
    }
    if (!res.ok) return null

    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_BYTES) return null
    return new TextDecoder('utf-8').decode(buf)
  }
  return null // too many redirects
}

export default async function handler(req: any, res: any): Promise<void> {
  setCors(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const url = typeof req.query?.url === 'string' ? req.query.url : ''
  if (!url) {
    res.status(400).json({ ok: false, message: 'Missing ?url= parameter.' })
    return
  }

  try {
    const html = await safeFetchHtml(url)
    if (html === null) {
      res.status(200).json({ ok: false, message: 'Could not fetch that page.' })
      return
    }
    const draft = extractRecipeFromHtml(html)
    if (!draft) {
      res
        .status(200)
        .json({ ok: false, message: 'No recipe found on that page. You can enter it manually.' })
      return
    }
    draft.sourceUrl = url
    res.status(200).json({ ok: true, data: draft })
  } catch (e) {
    // SSRF rejection / DNS / network — never leak which; log server-side only.
    console.error('scrape error:', e)
    res.status(200).json({ ok: false, message: 'Could not fetch that page.' })
  }
}
