routerAdd(
  'POST',
  '/backend/v1/sync/control',
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
    if (typeof body.block_writes !== 'boolean') {
      return e.badRequestError('SYNC_CONTROL_INVALID')
    }
    const control = $app.findFirstRecordByFilter('sync_control', "id != ''")
    control.set('block_writes', body.block_writes)
    control.set('note', String(body.reason || '').slice(0, 500))
    $app.save(control)
    return e.json(200, {
      success: true,
      block_writes: control.getBool('block_writes'),
    })
  },
  $apis.bodyLimit(8192),
)
