import { createServer } from 'http'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { shell } from 'electron'
import { normaliseName } from './grocery-merge'

// Append-only client for the household "Groceries" Google Tasks list — the same list
// the Discord bot's !groceries commands and the phones' Google Tasks app use.
// Loopback OAuth + REST via global fetch, adapted from nanoblock-tracker's
// google-tasks-sync.ts (which mirrors; this only ever adds tasks, so no reconcile loop).

const SCOPE = 'https://www.googleapis.com/auth/tasks'
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

interface StoredToken {
  access_token: string
  refresh_token: string
  expiry: number // epoch ms
}

let userDataPath = ''
let authInFlight: Promise<string> | null = null

const log = (...args: unknown[]): void => console.log('[google-tasks]', ...args)

export function initGoogleTasks(userData: string): void {
  userDataPath = userData
}

// ── auth ──────────────────────────────────────────────────────────────────────

function credentialsPath(): string {
  return join(userDataPath, 'google-credentials.json')
}

function tokenPath(): string {
  return join(userDataPath, 'google-tasks-token.json')
}

function loadClient(): { client_id: string; client_secret: string } | null {
  if (!existsSync(credentialsPath())) return null
  const raw = JSON.parse(readFileSync(credentialsPath(), 'utf-8'))
  const c = raw.installed ?? raw.web
  return c ? { client_id: c.client_id, client_secret: c.client_secret } : null
}

export function googleStatus(): { credentials: boolean; signedIn: boolean } {
  return { credentials: loadClient() !== null, signedIn: existsSync(tokenPath()) }
}

async function exchangeToken(params: Record<string, string>): Promise<StoredToken> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  const existing = existsSync(tokenPath())
    ? (JSON.parse(readFileSync(tokenPath(), 'utf-8')) as StoredToken)
    : null
  const token: StoredToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? existing?.refresh_token ?? '',
    expiry: Date.now() + data.expires_in * 1000
  }
  writeFileSync(tokenPath(), JSON.stringify(token, null, 2), 'utf-8')
  return token
}

/** Loopback OAuth sign-in: opens the system browser, waits for the redirect. */
function browserSignIn(client: { client_id: string; client_secret: string }): Promise<StoredToken> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('Sign-in timed out after 5 minutes'))
    }, SIGN_IN_TIMEOUT_MS)

    server.on('request', async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      if (!code) {
        res.writeHead(400).end('Missing code')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<h2>RecipeVault is connected to Google Tasks — you can close this tab.</h2>')
      clearTimeout(timeout)
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close()
      try {
        resolve(
          await exchangeToken({
            code,
            client_id: client.client_id,
            client_secret: client.client_secret,
            redirect_uri: `http://127.0.0.1:${port}`,
            grant_type: 'authorization_code'
          })
        )
      } catch (e) {
        reject(e)
      }
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      const params = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent'
      })
      shell.openExternal(`${AUTH_URL}?${params.toString()}`)
      log('Browser opened for Google Tasks sign-in')
    })
  })
}

/** Returns a valid access token, refreshing or running first-time sign-in as needed. */
async function getAccessToken(): Promise<string> {
  if (authInFlight) return authInFlight
  authInFlight = (async () => {
    const client = loadClient()
    if (!client) {
      throw new Error(
        'google-credentials.json missing — copy it into the RecipeVault data folder (see Settings).'
      )
    }

    let token: StoredToken | null = existsSync(tokenPath())
      ? (JSON.parse(readFileSync(tokenPath(), 'utf-8')) as StoredToken)
      : null

    if (token && Date.now() < token.expiry - 60_000) return token.access_token

    if (token?.refresh_token) {
      try {
        token = await exchangeToken({
          refresh_token: token.refresh_token,
          client_id: client.client_id,
          client_secret: client.client_secret,
          grant_type: 'refresh_token'
        })
        return token.access_token
      } catch (e) {
        log('Refresh failed (token likely expired) — starting browser sign-in', e)
      }
    }

    token = await browserSignIn(client)
    return token.access_token
  })()
  try {
    return await authInFlight
  } finally {
    authInFlight = null
  }
}

export async function signIn(): Promise<void> {
  await getAccessToken()
}

// ── Tasks API ─────────────────────────────────────────────────────────────────

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(`${TASKS_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`Tasks API ${method} ${path}: ${res.status} ${await res.text()}`)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

async function findOrCreateList(listTitle: string): Promise<string> {
  let pageToken = ''
  do {
    const page = await api<{ items?: { id: string; title: string }[]; nextPageToken?: string }>(
      'GET',
      `/users/@me/lists?maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`
    )
    const match = (page.items ?? []).find((l) => l.title === listTitle)
    if (match) return match.id
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  const created = await api<{ id: string }>('POST', '/users/@me/lists', { title: listTitle })
  log(`Created task list "${listTitle}"`)
  return created.id
}

async function listPending(listId: string): Promise<{ id: string; title: string }[]> {
  const tasks: { id: string; title: string }[] = []
  let pageToken = ''
  do {
    const page = await api<{
      items?: { id: string; title: string }[]
      nextPageToken?: string
    }>(
      'GET',
      `/lists/${listId}/tasks?maxResults=100&showCompleted=false` +
        (pageToken ? `&pageToken=${pageToken}` : '')
    )
    tasks.push(...(page.items ?? []))
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return tasks
}

/**
 * Adds grocery titles to the list, skipping any whose name part already matches a
 * pending task (so "Onions (3)" doesn't duplicate a bare "onions" the bot added).
 */
export async function addGroceries(
  listTitle: string,
  titles: string[]
): Promise<{ added: number; skipped: number }> {
  const listId = await findOrCreateList(listTitle)
  const pending = new Set((await listPending(listId)).map((t) => normaliseName(t.title)))
  let added = 0
  let skipped = 0
  for (const title of titles) {
    if (pending.has(normaliseName(title))) {
      skipped++
      continue
    }
    await api('POST', `/lists/${listId}/tasks`, { title })
    pending.add(normaliseName(title))
    added++
  }
  return { added, skipped }
}
