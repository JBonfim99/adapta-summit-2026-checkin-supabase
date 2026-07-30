routerAdd(
  'POST',
  '/backend/v1/sync/outbox/ack',
  (e) => {
    const timestamp = e.request.header.get('X-Sync-Timestamp') || ''
    const supplied = (e.request.header.get('X-Sync-Signature') || '').toLowerCase()
    const secret = $secrets.get('SUPABASE_SYNC_HMAC_SECRET') || ''
    const timestampMs = Number(timestamp) * 1000
    const expected = secret
      ? $security.hs256(timestamp + '.POST.' + e.request.requestURI, secret).toLowerCase()
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

    const body = e.requestInfo().body || {}
    const ids = Array.isArray(body.event_ids) ? body.event_ids : []
    if (ids.length === 0 || ids.length > 100) return e.badRequestError('SYNC_ACK_BATCH_INVALID')
    let acknowledged = 0
    $app.runInTransaction((txApp) => {
      for (let index = 0; index < ids.length; index++) {
        let record = null
        try {
          record = txApp.findFirstRecordByData('sync_outbox', 'event_id', String(ids[index]))
        } catch (_) {}
        if (record && record.getString('state') === 'pending') {
          record.set('state', 'delivered')
          record.set('delivered_at', new Date().toISOString())
          txApp.save(record)
          acknowledged++
        }
      }
    })
    return e.json(200, { acknowledged: acknowledged })
  },
  $apis.bodyLimit(32768),
)
