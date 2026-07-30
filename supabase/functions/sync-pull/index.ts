import { adminDb } from '../_shared/db.ts'
import { ApiError, handler, json } from '../_shared/http.ts'
import { skipSyncRequest } from '../_shared/skip-sync.ts'

type AnyRow = Record<string, any>

const collections = ['compradores', 'ingressos', 'participantes'] as const

type CollectionName = (typeof collections)[number]

interface SnapshotResponse {
  collection: CollectionName
  items: AnyRow[]
  total: number
  has_more: boolean
  next_cursor: string | null
}

interface OutboxResponse {
  events: Array<{
    event_id: string
    table: CollectionName
    record_id: string
    operation: 'create' | 'update' | 'delete'
    source_updated_at: string
    payload: Record<string, unknown>
  }>
  backlog: number
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function hmac(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

function workerAuthorized(req: Request) {
  const supplied = req.headers.get('X-Worker-Key') ?? ''
  const expected =
    Deno.env.get('SYNC_PULL_WORKER_SECRET') ?? Deno.env.get('DISPATCH_WORKER_SECRET') ?? ''
  return Boolean(expected) && constantTimeEqual(supplied, expected)
}

async function skipTriggerAuthorized(req: Request, rawBody: string) {
  const secret = Deno.env.get('SKIP_SYNC_HMAC_SECRET') ?? ''
  const timestamp = req.headers.get('X-Sync-Timestamp') ?? ''
  const supplied = (req.headers.get('X-Sync-Signature') ?? '').toLowerCase()
  const timestampMs = Number(timestamp) * 1000
  if (
    !secret ||
    !timestamp ||
    !supplied ||
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000
  ) {
    return false
  }
  return constantTimeEqual(await hmac(`${timestamp}.${rawBody}`, secret), supplied)
}

async function statusPayload() {
  const db = adminDb()
  const [{ data: state, error }, { data: bootstrap }] = await Promise.all([
    db.from('system_state').select('*').eq('singleton', true).single(),
    db
      .from('sync_bootstrap_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (error) throw error
  return { state, bootstrap }
}

async function recordPoll(backlog: number, error: string | null = null) {
  const { error: rpcError } = await adminDb().rpc('record_sync_poll', {
    p_backlog: Math.max(0, backlog),
    p_error: error,
  })
  if (rpcError) throw rpcError
}

async function beginBootstrap() {
  const db = adminDb()
  const { data: active } = await db
    .from('sync_bootstrap_runs')
    .select('*')
    .in('state', ['collecting', 'ready', 'applying'])
    .maybeSingle()
  if (active) return active

  const source = await skipSyncRequest<{
    cursor: Record<string, unknown>
    backlog: number
  }>('/backend/v1/sync/status')
  const { data: run, error } = await db
    .from('sync_bootstrap_runs')
    .insert({
      state: 'collecting',
      source_cursor: source.cursor ?? {},
      counts: {},
      current_collection: collections[0],
      next_cursor: null,
    })
    .select('*')
    .single()
  if (error) throw error
  const { error: stateError } = await db
    .from('system_state')
    .update({
      bootstrap_state: 'collecting',
      external_effects_enabled: false,
      last_sync_error: null,
      sync_outbox_backlog: Math.max(0, source.backlog ?? 0),
    })
    .eq('singleton', true)
  if (stateError) throw stateError
  return run
}

async function processBootstrapPage(run: AnyRow) {
  const collection = String(run.current_collection || collections[0]) as CollectionName
  const index = collections.indexOf(collection)
  if (index < 0) throw new Error('BOOTSTRAP_COLLECTION_INVALID')
  const cursor = String(run.next_cursor ?? '')
  const target =
    `/backend/v1/sync/snapshot?collection=${encodeURIComponent(collection)}` +
    `&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
  const page = await skipSyncRequest<SnapshotResponse>(target)
  if (page.collection !== collection || !Array.isArray(page.items)) {
    throw new Error('BOOTSTRAP_PAGE_INVALID')
  }

  const db = adminDb()
  if (page.items.length > 0) {
    const rows = page.items.map((record) => ({
      run_id: run.id,
      source_table: collection,
      record_id: String(record.id),
      payload: {
        ...record,
        created_at: record.created_at ?? record.created,
        updated_at: record.updated_at ?? record.updated,
      },
      source_updated_at:
        record.updated_at ??
        record.updated ??
        record.created_at ??
        record.created ??
        new Date().toISOString(),
    }))
    const { error } = await db
      .from('sync_bootstrap_rows')
      .upsert(rows, { onConflict: 'run_id,source_table,record_id' })
    if (error) throw error
  }

  const counts = { ...(run.counts ?? {}) }
  if (page.has_more) {
    const { data, error } = await db
      .from('sync_bootstrap_runs')
      .update({ next_cursor: page.next_cursor })
      .eq('id', run.id)
      .select('*')
      .single()
    if (error) throw error
    return data
  }

  const { count: stagedCount, error: countError } = await db
    .from('sync_bootstrap_rows')
    .select('*', { count: 'exact', head: true })
    .eq('run_id', run.id)
    .eq('source_table', collection)
  if (countError) throw countError
  counts[collection] = Math.max(0, Number(stagedCount ?? 0))
  const nextCollection = collections[index + 1]
  const update = nextCollection
    ? {
        counts,
        current_collection: nextCollection,
        next_cursor: null,
      }
    : {
        counts,
        current_collection: null,
        next_cursor: null,
        state: 'ready',
        preview_completed_at: new Date().toISOString(),
      }
  const { data, error } = await db
    .from('sync_bootstrap_runs')
    .update(update)
    .eq('id', run.id)
    .select('*')
    .single()
  if (error) throw error
  if (!nextCollection) {
    const { error: stateError } = await db
      .from('system_state')
      .update({ bootstrap_state: 'ready' })
      .eq('singleton', true)
    if (stateError) throw stateError
  }
  return data
}

async function advanceBootstrap(run: AnyRow) {
  let current = run
  const deadline = performance.now() + 18_000
  while (current?.state === 'collecting' && performance.now() < deadline) {
    current = await processBootstrapPage(current)
  }
  return current
}

async function pullOutbox() {
  const page = await skipSyncRequest<OutboxResponse>('/backend/v1/sync/outbox?limit=100')
  if (!Array.isArray(page.events)) throw new Error('SYNC_OUTBOX_RESPONSE_INVALID')
  if (page.events.length === 0) {
    await recordPoll(page.backlog ?? 0)
    return { accepted: 0, acknowledged: 0, backlog: page.backlog ?? 0 }
  }

  const db = adminDb()
  const acknowledged: string[] = []
  const failed: Array<{ event_id: string; error: string }> = []
  for (const event of page.events) {
    const { data, error } = await db.rpc('apply_sync_event', { p_event: event })
    const state = (data as AnyRow | null)?.state
    if (!error && ['applied', 'duplicate', 'ignored'].includes(String(state))) {
      acknowledged.push(event.event_id)
    } else {
      failed.push({ event_id: event.event_id, error: error?.message ?? `SYNC_${state}` })
    }
  }

  if (acknowledged.length > 0) {
    await skipSyncRequest('/backend/v1/sync/outbox/ack', {
      method: 'POST',
      body: { event_ids: acknowledged },
    })
  }
  const remaining = Math.max(0, Number(page.backlog ?? 0) - acknowledged.length)
  const error = failed.length > 0 ? JSON.stringify(failed).slice(0, 2000) : null
  await recordPoll(remaining, error)
  return {
    accepted: page.events.length,
    acknowledged: acknowledged.length,
    failed,
    backlog: remaining,
  }
}

async function runAction(action: string) {
  const db = adminDb()
  if (action === 'status') return statusPayload()

  const leaseToken = crypto.randomUUID()
  const { data: claimed, error: claimError } = await db.rpc('claim_sync_lease', {
    p_token: leaseToken,
    p_ttl_seconds: 25,
  })
  if (claimError) throw claimError
  if (!claimed) return { skipped: true, reason: 'SYNC_ALREADY_RUNNING', ...(await statusPayload()) }

  try {
    if (action === 'preview_bootstrap') {
      const run = await beginBootstrap()
      const bootstrap = await advanceBootstrap(run)
      const { error: stateError } = await db
        .from('system_state')
        .update({ last_sync_error: null })
        .eq('singleton', true)
      if (stateError) throw stateError
      return { bootstrap }
    }
    if (action === 'apply_bootstrap') {
      const { data: run, error } = await db
        .from('sync_bootstrap_runs')
        .select('id,state')
        .eq('state', 'ready')
        .maybeSingle()
      if (error) throw error
      if (!run) throw new ApiError(409, 'BOOTSTRAP_NOT_READY')
      const { data: result, error: finalizeError } = await db.rpc('finalize_sync_bootstrap', {
        p_run_id: run.id,
      })
      if (finalizeError) throw finalizeError
      if ((result as AnyRow)?.state !== 'completed') {
        throw new ApiError(409, 'BOOTSTRAP_APPLY_FAILED', result)
      }
      return { bootstrap: result, incremental: await pullOutbox() }
    }
    if (action === 'pull_now') {
      const { data: state, error } = await db
        .from('system_state')
        .select('bootstrap_state')
        .eq('singleton', true)
        .single()
      if (error) throw error
      if (state.bootstrap_state !== 'completed') {
        throw new ApiError(409, 'BOOTSTRAP_REQUIRED')
      }
      return { incremental: await pullOutbox() }
    }
    if (action === 'poll') {
      const { state, bootstrap } = await statusPayload()
      if (bootstrap?.state === 'collecting') {
        const advanced = await advanceBootstrap(bootstrap)
        await recordPoll(Number(state.sync_outbox_backlog ?? 0))
        return { bootstrap: advanced }
      }
      if (state.bootstrap_state === 'completed') {
        return { incremental: await pullOutbox() }
      }
      return { skipped: true, reason: 'BOOTSTRAP_NOT_STARTED', state, bootstrap }
    }
    throw new ApiError(400, 'SYNC_ACTION_INVALID')
  } catch (error) {
    try {
      const message = error instanceof Error ? error.message : 'SYNC_PULL_FAILED'
      await recordPoll(0, message)
    } catch (_) {
      // Preserve the original failure.
    }
    throw error
  } finally {
    await db.rpc('release_sync_lease', { p_token: leaseToken })
  }
}

Deno.serve((req) =>
  handler(req, async () => {
    if (req.method !== 'POST') throw new ApiError(404, 'ROUTE_NOT_FOUND')
    const rawBody = await req.text()
    const authorized = workerAuthorized(req) || (await skipTriggerAuthorized(req, rawBody))
    if (!authorized) throw new ApiError(401, 'SYNC_PULL_ACCESS_DENIED')
    let input: { action?: string }
    try {
      input = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      throw new ApiError(400, 'JSON_INVALIDO')
    }
    return json({ success: true, ...(await runAction(input.action ?? 'poll')) })
  }),
)
