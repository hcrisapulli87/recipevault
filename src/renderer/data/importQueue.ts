import { supabase } from './supabase'
import type { ImportQueueItem, InstagramPost, IpcResult } from '../../shared/types'

const COLS = 'id, owner_id, url, status, caption, uploader, error, created_at'

function mapRow(r: Record<string, unknown>): ImportQueueItem {
  return {
    id: r.id as number,
    ownerId: r.owner_id as string,
    url: r.url as string,
    status: r.status as ImportQueueItem['status'],
    caption: (r.caption as string) ?? null,
    uploader: (r.uploader as string) ?? null,
    error: (r.error as string) ?? null,
    createdAt: r.created_at as string
  }
}

/** Phone side: queue a reel URL for the desktop app to fetch. */
export async function queueImport(url: string): Promise<void> {
  const { error } = await supabase.from('import_queue').insert({ url })
  if (error) throw new Error(error.message)
}

/** The signed-in user's own queue, newest first (drives the Import page list). */
export async function listMyImports(ownerId: string): Promise<ImportQueueItem[]> {
  const { data, error } = await supabase
    .from('import_queue')
    .select(COLS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapRow)
}

/** Desktop worker: ALL household pending rows, oldest first (RLS allows household update). */
async function listPendingImports(): Promise<ImportQueueItem[]> {
  const { data, error } = await supabase
    .from('import_queue')
    .select(COLS)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(mapRow)
}

/**
 * Desktop worker sweep: fetch every pending reel serially (no parallel hammering
 * of Instagram) and write results back. `fetchPost` is the IPC bridge — injected
 * so this stays unit-testable.
 */
export async function processPending(
  fetchPost: (url: string) => Promise<IpcResult<InstagramPost>>
): Promise<void> {
  const pending = await listPendingImports()
  for (const item of pending) {
    const res = await fetchPost(item.url)
    const patch = res.ok
      ? { status: 'fetched', caption: res.data.caption, uploader: res.data.uploader, error: null }
      : { status: 'failed', error: res.message }
    const { error } = await supabase.from('import_queue').update(patch).eq('id', item.id)
    if (error) throw new Error(error.message)
  }
}

export async function retryImport(id: number): Promise<void> {
  const { error } = await supabase
    .from('import_queue')
    .update({ status: 'pending', error: null })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteImport(id: number): Promise<void> {
  const { error } = await supabase.from('import_queue').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
