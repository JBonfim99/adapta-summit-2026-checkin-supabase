routerAdd('GET', '/backend/v1/sync/status', (e) => {
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

  const control = $app.findFirstRecordByFilter('sync_control', "id != ''")
  let cursor = {}
  try {
    const latest = $app.findFirstRecordByFilter('sync_outbox', "state = 'pending'", '-created,-id')
    cursor = {
      created: latest.getString('created'),
      id: latest.id,
      event_id: latest.getString('event_id'),
    }
  } catch (_) {}
  return e.json(200, {
    backlog: $app.countRecords('sync_outbox', "state = 'pending'"),
    block_writes: control.getBool('block_writes'),
    cursor: cursor,
  })
})
