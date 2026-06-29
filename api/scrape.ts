// Vercel Node serverless function: GET /api/scrape?url=… → { ok, data } | { ok, message }.
// Recipe scraping must run server-side — a browser can't fetch third-party recipe pages (CORS).
// req/res are loosely typed to avoid a build-time dependency on @vercel/node; Vercel supplies
// the real Node request/response at runtime.
import { fetchAndExtract, ScrapeError } from '../src/shared/recipe-scraper'

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
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
    const data = await fetchAndExtract(url)
    res.status(200).json({ ok: true, data })
  } catch (e) {
    res.status(200).json({
      ok: false,
      message: e instanceof ScrapeError ? e.message : 'Something went wrong fetching that page.'
    })
  }
}
