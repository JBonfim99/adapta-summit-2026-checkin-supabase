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
  const pendingCoreFilter =
    "state = 'pending' && (source_table = 'compradores' || source_table = 'ingressos' || source_table = 'participantes')"
  const pendingCoreExpression = $dbx.and(
    $dbx.hashExp({ state: 'pending' }),
    $dbx.in('source_table', 'compradores', 'ingressos', 'participantes'),
  )
  let cursor = {}
  try {
    const latest = $app.findRecordsByFilter('sync_outbox', pendingCoreFilter, '-created,-id', 1, 0)
    if (latest.length > 0) {
      cursor = {
        created: latest[0].getString('created'),
        id: latest[0].id,
        event_id: latest[0].getString('event_id'),
      }
    }
  } catch (_) {}
  return e.json(200, {
    backlog: $app.countRecords('sync_outbox', pendingCoreExpression),
    block_writes: control.getBool('block_writes'),
    cursor: cursor,
  })
})
