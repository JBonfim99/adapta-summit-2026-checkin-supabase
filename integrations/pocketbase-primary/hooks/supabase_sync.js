// Copy this file to pb_hooks only after applying 0040_supabase_sync_outbox.js.
// Required env: SUPABASE_SYNC_URL and SUPABASE_SYNC_HMAC_SECRET.

const SYNCED_COLLECTIONS = [
  'compradores',
  'ingressos',
  'participantes',
  'tokens_acesso',
  'links_participante',
  'webhooks_log',
  'disparos',
  'envios',
  'pedidos_guru',
  'disparos_wa',
  'cortesias',
]

const syncControl = () => {
  try {
    return $app.findFirstRecordByFilter('sync_control', "id != ''")
  } catch (_) {
    return null
  }
}

const assertPrimaryWritable = () => {
  const control = syncControl()
  if (control && control.getBool('block_writes')) {
    throw new ForbiddenError(
      'O PocketBase esta em modo somente leitura. Use o fallback Supabase.',
    )
  }
}

const recordPayload = (record) => {
  const fields = record.fieldsData()
  const payload = {}
  Object.keys(fields).forEach((key) => {
    payload[key] = fields[key]
  })
  payload.id = record.id
  payload.created_at = record.getString('created')
  payload.updated_at = record.getString('updated')
  return payload
}

const enqueueSyncEvent = (record, operation) => {
  try {
    const outbox = $app.findCollectionByNameOrId('sync_outbox')
    const event = new Record(outbox)
    const timestamp =
      record.getString('updated') || record.getString('created') || new Date().toISOString()
    event.set('event_id', $security.randomString(48))
    event.set('source_table', record.collection().name)
    event.set('record_id', record.id)
    event.set('operation', operation)
    event.set('payload', operation === 'delete' ? {} : recordPayload(record))
    event.set('source_updated_at', timestamp)
    event.set('state', 'pending')
    event.set('attempts', 0)
    $app.save(event)
  } catch (error) {
    console.error('SUPABASE_OUTBOX_ENQUEUE_FAILED', operation, record.id, error)
  }
}

onRecordCreate(
  (event) => {
    assertPrimaryWritable()
    event.next()
  },
  ...SYNCED_COLLECTIONS,
)

onRecordUpdate(
  (event) => {
    assertPrimaryWritable()
    event.next()
  },
  ...SYNCED_COLLECTIONS,
)

onRecordDelete(
  (event) => {
    assertPrimaryWritable()
    event.next()
  },
  ...SYNCED_COLLECTIONS,
)

onRecordAfterCreateSuccess(
  (event) => {
    event.next()
    enqueueSyncEvent(event.record, 'create')
  },
  ...SYNCED_COLLECTIONS,
)

onRecordAfterUpdateSuccess(
  (event) => {
    event.next()
    enqueueSyncEvent(event.record, 'update')
  },
  ...SYNCED_COLLECTIONS,
)

onRecordAfterDeleteSuccess(
  (event) => {
    event.next()
    enqueueSyncEvent(event.record, 'delete')
  },
  ...SYNCED_COLLECTIONS,
)

const responseText = (body) => {
  if (body == null) return ''
  if (typeof body === 'string') return body
  try {
    return new TextDecoder().decode(body)
  } catch (_) {
    return ''
  }
}

const retryAt = (attempts) => {
  const seconds = Math.min(900, 15 * Math.pow(2, Math.max(0, attempts - 1)))
  return new Date(Date.now() + seconds * 1000).toISOString()
}

cronAdd('supabase_sync_outbox', '* * * * *', () => {
  const control = syncControl()
  if (control && control.getBool('delivery_paused')) return

  const endpoint = $os.getenv('SUPABASE_SYNC_URL') || ''
  const secret = $os.getenv('SUPABASE_SYNC_HMAC_SECRET') || ''
  if (!endpoint || !secret) return

  let candidates = []
  try {
    candidates = $app.findRecordsByFilter(
      'sync_outbox',
      "state = 'pending' || state = 'error'",
      'created',
      50,
      0,
    )
  } catch (_) {
    return
  }

  const now = Date.now()
  const batch = candidates.filter((record) => {
    const next = record.getString('next_attempt_at')
    return !next || new Date(next).getTime() <= now
  })
  if (batch.length === 0) return

  const events = batch.map((record) => ({
    event_id: record.getString('event_id'),
    table: record.getString('source_table'),
    record_id: record.getString('record_id'),
    operation: record.getString('operation'),
    source_updated_at: record.getString('source_updated_at'),
    payload: record.get('payload') || {},
  }))
  const raw = JSON.stringify({ events: events })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = $security.hs256(timestamp + '.' + raw, secret)

  batch.forEach((record) => {
    record.set('state', 'delivering')
    try {
      $app.save(record)
    } catch (_) {}
  })

  let status = 0
  let parsed = null
  let errorMessage = ''
  try {
    const response = $http.send({
      url: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Timestamp': timestamp,
        'X-Sync-Signature': signature,
      },
      body: raw,
      timeout: 20,
    })
    status = response.statusCode
    const text = responseText(response.body)
    parsed = text ? JSON.parse(text) : null
    if (status < 200 || status >= 300) errorMessage = 'HTTP ' + status
  } catch (error) {
    errorMessage = error && error.message ? error.message : 'delivery error'
  }

  const byEvent = {}
  if (parsed && Array.isArray(parsed.results)) {
    parsed.results.forEach((result) => {
      byEvent[result.eventId] = result
    })
  }

  batch.forEach((record) => {
    const eventId = record.getString('event_id')
    const result = byEvent[eventId]
    const delivered =
      result &&
      (result.state === 'applied' ||
        result.state === 'duplicate' ||
        result.state === 'ignored')
    if (delivered) {
      record.set('state', 'delivered')
      record.set('delivered_at', new Date().toISOString())
      record.set('last_error', '')
      record.set('next_attempt_at', '')
    } else {
      const attempts = record.getInt('attempts') + 1
      record.set('state', 'error')
      record.set('attempts', attempts)
      record.set(
        'last_error',
        String((result && result.error) || errorMessage || 'invalid sync response').slice(
          0,
          1000,
        ),
      )
      record.set('next_attempt_at', retryAt(attempts))
    }
    try {
      $app.save(record)
    } catch (_) {}
  })
})
