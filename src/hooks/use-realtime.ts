import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase/client'

/**
 * Refreshes Edge Function-backed screens without granting browser access
 * to the underlying tables.
 */
export function useRealtime<TRecord = Record<string, unknown>>(
  collectionName: string,
  callback: (data: { action: 'refresh'; record?: TRecord }) => void,
  enabled: boolean = true,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!enabled) return

    let disposed = false
    const refresh = () => callbackRef.current({ action: 'refresh' })
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
          if (!changedTable || changedTable === collectionName) refresh()
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') refresh()
        })
    })

    return () => {
      disposed = true
      window.removeEventListener('focus', refresh)
      void supabase.removeChannel(channel)
    }
  }, [collectionName, enabled])
}

export default useRealtime
