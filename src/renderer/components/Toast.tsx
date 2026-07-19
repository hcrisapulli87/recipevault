import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

const ToastContext = createContext<(message: string) => void>(() => {})

/** Fire-and-forget toast: dark glass pill above the dock, auto-dismisses. */
// eslint-disable-next-line react-refresh/only-export-components -- tiny hook that belongs with its provider
export function useToast(): (message: string) => void {
  return useContext(ToastContext)
}

export function ToastProvider(props: { children: ReactNode }): JSX.Element {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((m: string) => {
    setMessage(m)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), 2200)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {props.children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  )
}
