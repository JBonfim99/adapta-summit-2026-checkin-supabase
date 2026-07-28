import { useEffect, useRef } from 'react'

/**
 * Refreshes Edge Function-backed screens without granting browser access
 * to the underlying tables.
 */
export function useRealtime<TRecord = Record<string, unknown>>(
  _collectionName: string,
  callback: (data: { action: 'refresh'; record?: TRecord }) => void,
  enabled: boolean = true,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!enabled) return

    const refresh = () => callbackRef.current({ action: 'refresh' })
    const timer = window.setInterval(refresh, 15_000)
    window.addEventListener('focus', refresh)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [enabled])
}

export default useRealtime
