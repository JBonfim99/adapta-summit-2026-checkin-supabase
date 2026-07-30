import { ApiError } from './http.ts'

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function signature(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

export async function skipSyncRequest<T>(
  target: string,
  options: {
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
    timeoutMs?: number
  } = {},
): Promise<T> {
  const baseUrl = (Deno.env.get('SKIP_SYNC_BASE_URL') ?? '').replace(/\/$/, '')
  const secret = Deno.env.get('SKIP_SYNC_HMAC_SECRET') ?? ''
  if (!baseUrl || !secret) throw new ApiError(503, 'SKIP_SYNC_NOT_CONFIGURED')

  const method = options.method ?? 'GET'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const canonical = `${timestamp}.${method}.${target}`
  const response = await fetch(`${baseUrl}${target}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Timestamp': timestamp,
      'X-Sync-Signature': await signature(canonical, secret),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
  })
  const text = await response.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { message: text.slice(0, 500) }
  }
  if (!response.ok) {
    throw new ApiError(502, 'SKIP_SYNC_REQUEST_FAILED', {
      status: response.status,
      response: data,
    })
  }
  return data as T
}

export function setSkipWriteBlock(blockWrites: boolean, reason: string) {
  return skipSyncRequest<{ success: boolean; block_writes: boolean }>('/backend/v1/sync/control', {
    method: 'POST',
    body: { block_writes: blockWrites, reason },
  })
}
