// SSRF guard for the public /api/scrape endpoint: only allow http(s) URLs that resolve to
// public IP addresses. Blocks loopback, private, link-local (incl. cloud metadata 169.254.x),
// CGNAT, ULA, and multicast/reserved ranges. Re-checked on every redirect by the caller.
// (Best-effort against DNS rebinding — resolve-then-fetch has a small TOCTOU window; acceptable
// for this app. Underscore-prefixed so Vercel does not treat it as a route.)
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a >= 224) return true // multicast / reserved
  return false
}

function isBlockedIPv6(ip: string): boolean {
  const lc = ip.toLowerCase()
  if (lc === '::1' || lc === '::') return true
  if (lc.startsWith('fe80')) return true // link-local
  if (lc.startsWith('fc') || lc.startsWith('fd')) return true // unique-local fc00::/7
  const mapped = lc.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) return isBlockedIPv4(mapped[1])
  return false
}

function isBlockedIP(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return isBlockedIPv4(ip)
  if (v === 6) return isBlockedIPv6(ip)
  return true // unknown form → block
}

/** Throws if the URL isn't a public http(s) target. Returns the parsed URL on success. */
export async function assertPublicHttpUrl(urlStr: string): Promise<URL> {
  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    throw new Error('invalid-url')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad-scheme')
  const host = u.hostname

  if (isIP(host)) {
    if (isBlockedIP(host)) throw new Error('blocked-ip')
    return u
  }
  if (host.toLowerCase() === 'localhost') throw new Error('blocked-host')

  const addrs = await lookup(host, { all: true })
  if (addrs.length === 0) throw new Error('no-dns')
  for (const a of addrs) {
    if (isBlockedIP(a.address)) throw new Error('blocked-ip')
  }
  return u
}
