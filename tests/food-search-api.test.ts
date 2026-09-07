import { describe, it, expect, vi, afterEach } from 'vitest'
import handler from '../api/food-search'

// Minimal fakes for the Vercel req/res shapes the handler uses.
function makeReq(q?: string): Parameters<typeof handler>[0] {
  return { method: 'GET', headers: {}, query: q === undefined ? {} : { q } }
}
interface Captured {
  status: number | null
  body: unknown
  headers: Record<string, string>
}
function makeRes(): { res: Parameters<typeof handler>[1]; captured: Captured } {
  const captured: Captured = { status: null, body: null, headers: {} }
  const res = {
    setHeader(name: string, value: string) {
      captured.headers[name] = value
    },
    status(code: number) {
      captured.status = code
      return res
    },
    json(body: unknown) {
      captured.body = body
    },
    end() {
      captured.body = null
    }
  }
  return { res, captured }
}

const salHit = (name: string, code: string): Record<string, unknown> => ({
  product_name: name,
  brands: ['BrandCo'],
  code,
  nutriments: { 'energy-kcal_100g': 100 }
})

/** Stub fetch routing by hostname; records every requested URL. */
function stubFetch(
  route: (url: string) => { status: number; body?: unknown }
): string[] {
  const urls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(String(url))
    const r = route(String(url))
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body
    }
  })
  return urls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('food-search handler', () => {
  it('rejects a missing query', async () => {
    const { res, captured } = makeRes()
    await handler(makeReq(), res)
    expect(captured.status).toBe(400)
  })

  it('serves Search-a-licious results when it is healthy, without touching legacy', async () => {
    const urls = stubFetch((url) => {
      if (url.includes('search.openfoodfacts.org')) {
        return { status: 200, body: { hits: [salHit('Greek Yogurt', '111'), ...Array.from({ length: 9 }, (_, i) => salHit(`Yogurt ${i}`, `20${i}`))] } }
      }
      return { status: 500 }
    })
    const { res, captured } = makeRes()
    await handler(makeReq('greek yogurt'), res)
    const body = captured.body as { ok: boolean; products: { product_name?: string }[] }
    expect(body.ok).toBe(true)
    expect(body.products[0].product_name).toBe('Greek Yogurt')
    expect(urls.some((u) => u.includes('cgi/search.pl'))).toBe(false)
  })

  // Search-a-licious returns ZERO hits for a parenthesised query, and zero for
  // "<multi word> AND field:value". The old `(${q}) AND countries_tags:…` form therefore
  // never matched anything, the AU filter silently never applied, and every search fell
  // through to unfiltered world results.
  it('AU-filters the query without parentheses or an explicit AND', async () => {
    const urls = stubFetch((url) => {
      if (url.includes('search.openfoodfacts.org')) {
        return { status: 200, body: { hits: Array.from({ length: 10 }, (_, i) => salHit(`Milk ${i}`, `9${i}`)) } }
      }
      return { status: 500 }
    })
    const { res } = makeRes()
    await handler(makeReq('full cream milk'), res)
    const sal = urls.find((u) => u.includes('search.openfoodfacts.org')) ?? ''
    const q = decodeURIComponent(new URL(sal).searchParams.get('q') ?? '')
    expect(q).toBe('full cream milk countries_tags:"en:australia"')
    expect(q).not.toMatch(/[()]/)
    expect(q).not.toMatch(/\bAND\b/)
  })

  it('falls back to legacy search when Search-a-licious is down', async () => {
    const urls = stubFetch((url) => {
      if (url.includes('search.openfoodfacts.org')) return { status: 502 }
      return {
        status: 200,
        body: { products: [{ product_name: 'Chobani Greek Yogurt', brands: 'Chobani', code: '333', nutriments: { 'energy-kcal_100g': 90 } }] }
      }
    })
    const { res, captured } = makeRes()
    await handler(makeReq('greek yogurt'), res)
    const body = captured.body as { ok: boolean; products: { product_name?: string }[] }
    expect(body.ok).toBe(true)
    expect(body.products.some((p) => p.product_name === 'Chobani Greek Yogurt')).toBe(true)
    expect(urls.some((u) => u.includes('cgi/search.pl'))).toBe(true)
  })

  it('retries the flaky legacy endpoint once on a 5xx', async () => {
    let legacyCalls = 0
    stubFetch((url) => {
      if (url.includes('search.openfoodfacts.org')) return { status: 502 }
      legacyCalls++
      if (legacyCalls === 1) return { status: 503 }
      return {
        status: 200,
        body: { products: [{ product_name: 'Oats', code: '444', nutriments: { 'energy-kcal_100g': 380 } }] }
      }
    })
    const { res, captured } = makeRes()
    await handler(makeReq('oats'), res)
    const body = captured.body as { ok: boolean; products: unknown[] }
    expect(body.ok).toBe(true)
    expect(body.products.length).toBeGreaterThan(0)
    expect(legacyCalls).toBeGreaterThanOrEqual(2)
  })

  it('consults legacy when Search-a-licious is healthy but returns zero hits', async () => {
    const urls = stubFetch((url) => {
      if (url.includes('search.openfoodfacts.org')) return { status: 200, body: { hits: [] } }
      return {
        status: 200,
        body: { products: [{ product_name: 'Weet-Bix', brands: 'Sanitarium', code: '555', nutriments: { 'energy-kcal_100g': 360 } }] }
      }
    })
    const { res, captured } = makeRes()
    await handler(makeReq('weet-bix'), res)
    const body = captured.body as { ok: boolean; products: { product_name?: string }[] }
    expect(body.ok).toBe(true)
    expect(body.products.some((p) => p.product_name === 'Weet-Bix')).toBe(true)
    expect(urls.some((u) => u.includes('cgi/search.pl'))).toBe(true)
  })

  it('reports ok:false when every upstream source is down', async () => {
    stubFetch(() => ({ status: 502 }))
    const { res, captured } = makeRes()
    await handler(makeReq('anything'), res)
    const body = captured.body as { ok: boolean; message?: string }
    expect(body.ok).toBe(false)
    expect(body.message).toBeTruthy()
  })

  it('sets a CDN cache header on successful non-empty responses only', async () => {
    stubFetch((url) => {
      if (url.includes('search.openfoodfacts.org')) {
        return { status: 200, body: { hits: Array.from({ length: 10 }, (_, i) => salHit(`Milk ${i}`, `9${i}`)) } }
      }
      return { status: 500 }
    })
    const ok = makeRes()
    await handler(makeReq('milk'), ok.res)
    expect(ok.captured.headers['Cache-Control']).toContain('s-maxage')

    stubFetch(() => ({ status: 502 }))
    const fail = makeRes()
    await handler(makeReq('milk'), fail.res)
    expect(fail.captured.headers['Cache-Control'] ?? '').not.toContain('s-maxage')
  })
})
