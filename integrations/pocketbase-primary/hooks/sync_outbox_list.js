routerAdd('GET', '/backend/v1/sync/outbox', (e) => {
  const timestamp = e.request.header.get('X-Sync-Timestamp') || ''
  const supplied = (e.request.header.get('X-Sync-Signature') || '').toLowerCase()
  const secret = $secrets.get('SUPABASE_SYNC_HMAC_SECRET') || ''
  const timestampMs = Number(timestamp) * 1000
  const expected = secret
    ? $security.hs256(timestamp + '.GET.' + e.request.requestURI, secret).toLowerCase()
    : ''
  let mismatch = expected.length === supplied.length ? 0 : 1
  for (let index = 0; index < expected.length && index < supplied.length; index++) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index)
  }
  if (
    !timestamp ||
    !supplied ||
    !secret ||
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000 ||
    mismatch !== 0
  ) {
    return e.unauthorizedError('SYNC_SIGNATURE_INVALID')
  }

  const rawLimit = Number(e.request.url.query().get('limit') || 100)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 100
  const records = $app.findRecordsByFilter(
    'sync_outbox',
    "state = 'pending'",
    'created,id',
    limit,
    0,
  )
  const backlog = $app.countRecords('sync_outbox', "state = 'pending'")
  return e.json(200, {
    backlog: backlog,
    events: records.map((record) => ({
      event_id: record.getString('event_id'),
      table: record.getString('source_table'),
      record_id: record.getString('record_id'),
      operation: record.getString('operation'),
      source_updated_at: record.getString('source_updated_at'),
      payload: record.get('payload') || {},
    })),
  })
})
