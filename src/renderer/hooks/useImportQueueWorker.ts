import { useEffect } from 'react'
import { processPending } from '../data/importQueue'
import { onTableChange } from '../data/realtime'

/**
 * Desktop only: serve the household's queued Instagram fetches. Sweeps pending
 * rows on mount (catches anything queued while the PC was off), then re-sweeps
 * whenever the queue changes. Re-entrancy guard: one sweep at a time; a change
 * arriving mid-sweep schedules exactly one follow-up.
 */
export function useImportQueueWorker(): void {
  useEffect(() => {
    const api = window.api
    if (!api) return // web/PWA build — the phone is a queue producer, not a worker
    let busy = false
    let again = false
    const sweep = async (): Promise<void> => {
      if (busy) {
        again = true
        return
      }
      busy = true
      try {
        await processPending(api.fetchInstagram)
      } catch {
        // transient (offline, RLS during sign-out) — the next queue change retries
      }
      busy = false
      if (again) {
        again = false
        void sweep()
      }
    }
    void sweep()
    return onTableChange(['import_queue'], () => void sweep())
  }, [])
}
