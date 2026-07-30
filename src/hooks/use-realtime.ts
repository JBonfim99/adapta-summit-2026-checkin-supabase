import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'

/**
 * Refreshes Edge Function-backed screens without granting browser access
 * to the underlying tables.
 */
export function useRealtime<TRecord = Record<string, unknown>>(
  collectionNames: string | string[],
  callback: (data: { action: 'refresh'; record?: TRecord }) => void,
  enabled: boolean = true,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const collectionKey = Array.isArray(collectionNames)
    ? [...collectionNames].sort().join(',')
    : collectionNames

  useEffect(() => {
    if (!enabled) return

    let disposed = false
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => callbackRef.current({ action: 'refresh' })
    const refreshSoon = () => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(refresh, 200)
    }
    window.addEventListener('focus', refresh)

    const channel = supabase.channel('admin:operations', {
      config: { private: true, broadcast: { ack: true } },
    })

    void supabase.auth.getSession().then(({ data }) => {
      if (disposed || !data.session?.access_token) return
      supabase.realtime.setAuth(data.session.access_token)
      channel
        .on('broadcast', { event: '*' }, ({ payload }) => {
          const changedTable = String(
            (payload as Record<string, unknown>)?.table ??
              (payload as Record<string, unknown>)?.table_name ??
              '',
          )
          const names = collectionKey.split(',')
          if (!changedTable || names.includes(changedTable)) refreshSoon()
        })
        .subscribe()
    })

    return () => {
      disposed = true
      if (refreshTimer) clearTimeout(refreshTimer)
      window.removeEventListener('focus', refresh)
      void supabase.removeChannel(channel)
    }
  }, [collectionKey, enabled])
}

export default useRealtime
