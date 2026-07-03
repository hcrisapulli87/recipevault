import { supabase } from './supabase'

let channelSeq = 0

/**
 * Re-run `cb` whenever rows in any of the given tables change (insert/update/delete),
 * e.g. from another signed-in device. RLS scopes events to the user's own rows.
 * Callers refetch on change rather than patching state — same shape as their existing
 * `reload()` pattern, and plenty at household scale. Returns an unsubscribe function.
 */
export function onTableChange(tables: string[], cb: () => void): () => void {
  const channel = supabase.channel(`table-watch-${++channelSeq}`)
  for (const table of tables) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, cb)
  }
  channel.subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}
