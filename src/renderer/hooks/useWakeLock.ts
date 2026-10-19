import { useEffect } from 'react'

/**
 * Keep the screen on while mounted (Cooking Mode — nobody wants to unlock a phone with
 * floury hands). The browser drops the lock whenever the page is hidden, so it is taken
 * again each time the page comes back. Silently does nothing where unsupported.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let unmounted = false

    const acquire = async (): Promise<void> => {
      try {
        const next = await navigator.wakeLock.request('screen')
        if (unmounted) void next.release()
        else lock = next
      } catch {
        // denied (low battery mode, page not visible yet) — the next visibility change retries
      }
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      unmounted = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release().catch(() => undefined)
    }
  }, [])
}
