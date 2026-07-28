import { adminDb } from '../_shared/db.ts'
import { ApiError, handler, json, routePath } from '../_shared/http.ts'

interface SyncEvent {
  event_id: string
  table: string
  record_id: string
  operation: 'create' | 'update' | 'delete'
  source_updated_at: string
  payload?: Record<string, unknown>
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

async function verifySignature(req: Request, rawBody: string) {
  const secret = Deno.env.get('SYNC_HMAC_SECRET') ?? ''
  const timestamp = req.headers.get('X-Sync-Timestamp') ?? ''
  const supplied = (req.headers.get('X-Sync-Signature') ?? '').toLowerCase()
  if (!secret || !timestamp || !supplied) throw new ApiError(401, 'SYNC_SIGNATURE_REQUIRED')

  const timestampMs = Number(timestamp) * 1000
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    throw new ApiError(401, 'SYNC_TIMESTAMP_INVALID')
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  )
  if (!constantTimeEqual(hex(digest), supplied)) {
    throw new ApiError(401, 'SYNC_SIGNATURE_INVALID')
  }
}

function normalize(event: SyncEvent): SyncEvent {
  const payload = { ...(event.payload ?? {}) }
  if (payload.created && !payload.created_at) payload.created_at = payload.created
  if (payload.updated && !payload.updated_at) payload.updated_at = payload.updated
  return { ...event, payload }
}

Deno.serve((req) =>
  handler(req, async () => {
    const path = routePath(req, 'sync-ingest')
    if (req.method !== 'POST' || !['/', '/events', '/backend/v1/sync/events'].includes(path)) {
      throw new ApiError(404, 'ROUTE_NOT_FOUND')
    }

    const rawBody = await req.text()
    await verifySignature(req, rawBody)
    let parsed: { events?: SyncEvent[] }
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      throw new ApiError(400, 'JSON_INVALIDO')
    }

    const events = parsed.events ?? []
    if (!Array.isArray(events) || events.length === 0 || events.length > 100) {
      throw new ApiError(400, 'SYNC_BATCH_SIZE_INVALID')
    }

    const db = adminDb()
    const results: Array<Record<string, unknown>> = []
    for (const rawEvent of events) {
      const event = normalize(rawEvent)
      const { data, error } = await db.rpc('apply_sync_event', { p_event: event })
      if (error) {
        await db.from('sync_events').upsert(
          {
            event_id: event.event_id,
            source_table: event.table,
            record_id: event.record_id,
            operation: event.operation,
            payload: event.payload ?? {},
            source_updated_at: event.source_updated_at,
            state: 'failed',
            error: error.message,
          },
          { onConflict: 'event_id' },
        )
        results.push({ eventId: event.event_id, state: 'failed', error: error.message })
      } else {
        results.push(data as Record<string, unknown>)
      }
    }

    const failed = results.filter((result) => result.state === 'failed').length
    return json(
      {
        accepted: results.length,
        applied: results.filter((result) => result.state === 'applied').length,
        duplicates: results.filter((result) => result.state === 'duplicate').length,
        ignored: results.filter((result) => result.state === 'ignored').length,
        failed,
        results,
      },
      failed > 0 ? 207 : 200,
    )
  }),
)
