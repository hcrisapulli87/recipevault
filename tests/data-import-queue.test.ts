import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  queueImport,
  listMyImports,
  processPending,
  retryImport,
  deleteImport
} from '../src/renderer/data/importQueue'
import type { InstagramPost, IpcResult } from '../src/shared/types'

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as { patch: Record<string, unknown>; id: number }[],
  deletedIds: [] as number[]
}))

vi.mock('../src/renderer/data/supabase', () => {
  const chain = (data: unknown): Record<string, unknown> => {
    const result = { data, error: null }
    const node: Record<string, unknown> = {
      then: (ok: (r: unknown) => unknown) => Promise.resolve(result).then(ok)
    }
    for (const m of ['select', 'eq', 'order']) node[m] = () => chain(data)
    return node
  }
  return {
    supabase: {
      from: () => ({
        select: () => chain(state.rows),
        insert: (row: Record<string, unknown>) => {
          state.inserted.push(row)
          return Promise.resolve({ error: null })
        },
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: number) => {
            state.updated.push({ patch, id })
            return Promise.resolve({ error: null })
          }
        }),
        delete: () => ({
          eq: (_c: string, id: number) => {
            state.deletedIds.push(id)
            return Promise.resolve({ error: null })
          }
        })
      })
    }
  }
})

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    owner_id: 'user-1',
    url: 'https://www.instagram.com/reel/ABC123/',
    status: 'pending',
    caption: null,
    uploader: null,
    error: null,
    created_at: '2026-07-06T10:00:00Z',
    ...over
  }
}

beforeEach(() => {
  state.rows = []
  state.inserted = []
  state.updated = []
  state.deletedIds = []
})

describe('queueImport', () => {
  it('inserts the url (owner stamped by DB default)', async () => {
    await queueImport('https://www.instagram.com/reel/ABC123/')
    expect(state.inserted).toEqual([{ url: 'https://www.instagram.com/reel/ABC123/' }])
  })
})

describe('listMyImports', () => {
  it('maps snake_case rows to camelCase items', async () => {
    state.rows = [row({ status: 'fetched', caption: 'hello', uploader: 'Joe' })]
    const items = await listMyImports('user-1')
    expect(items).toEqual([
      {
        id: 1,
        ownerId: 'user-1',
        url: 'https://www.instagram.com/reel/ABC123/',
        status: 'fetched',
        caption: 'hello',
        uploader: 'Joe',
        error: null,
        createdAt: '2026-07-06T10:00:00Z'
      }
    ])
  })
})

describe('processPending', () => {
  it('fetches each pending row and marks success/failure', async () => {
    state.rows = [row({ id: 1 }), row({ id: 2, url: 'https://www.instagram.com/reel/XYZ/' })]
    const fetcher = async (url: string): Promise<IpcResult<InstagramPost>> =>
      url.includes('ABC123')
        ? { ok: true, data: { caption: 'the caption', uploader: 'Joe' } }
        : { ok: false, message: 'post may be private' }
    await processPending(fetcher)
    expect(state.updated).toEqual([
      { patch: { status: 'fetched', caption: 'the caption', uploader: 'Joe', error: null }, id: 1 },
      { patch: { status: 'failed', error: 'post may be private' }, id: 2 }
    ])
  })
})

describe('retry + delete', () => {
  it('retryImport resets a row to pending', async () => {
    await retryImport(7)
    expect(state.updated).toEqual([{ patch: { status: 'pending', error: null }, id: 7 }])
  })
  it('deleteImport deletes by id', async () => {
    await deleteImport(7)
    expect(state.deletedIds).toEqual([7])
  })
})
