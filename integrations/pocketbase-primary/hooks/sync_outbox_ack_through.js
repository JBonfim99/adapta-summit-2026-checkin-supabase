routerAdd(
  'POST',
  '/backend/v1/sync/outbox/ack-through',
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
    const cursor = body.cursor || {}
    const created = String(cursor.created || '')
    const id = String(cursor.id || '')
    const eventId = String(cursor.event_id || '')
    if (!created || !id || !eventId) {
      return e.badRequestError('SYNC_ACK_CURSOR_INVALID')
    }

    let cursorRecord = null
    try {
      cursorRecord = $app.findFirstRecordByData('sync_outbox', 'event_id', eventId)
    } catch (_) {}
    if (
      !cursorRecord ||
      cursorRecord.id !== id ||
      cursorRecord.getString('created') !== created ||
      ['compradores', 'ingressos', 'participantes'].indexOf(
        cursorRecord.getString('source_table'),
      ) === -1
    ) {
      return e.badRequestError('SYNC_ACK_CURSOR_MISMATCH')
    }

    const params = {
      created: created,
      id: id,
      deliveredAt: new Date().toISOString(),
    }
    const boundedPendingSql =
      "state = 'pending'" +
      " AND source_table IN ('compradores', 'ingressos', 'participantes')" +
      ' AND (created < {:created} OR (created = {:created} AND id <= {:id}))'
    const before = new DynamicModel({ c: 0 })
    $app
      .db()
      .newQuery('SELECT COUNT(*) as c FROM sync_outbox WHERE ' + boundedPendingSql)
      .bind(params)
      .one(before)
    $app
      .db()
      .newQuery(
        "UPDATE sync_outbox SET state = 'delivered', delivered_at = {:deliveredAt}" +
          ' WHERE ' +
          boundedPendingSql,
      )
      .bind(params)
      .execute()

    const backlog = new DynamicModel({ c: 0 })
    $app
      .db()
      .newQuery(
        "SELECT COUNT(*) as c FROM sync_outbox WHERE state = 'pending'" +
          " AND source_table IN ('compradores', 'ingressos', 'participantes')",
      )
      .one(backlog)
    return e.json(200, {
      acknowledged: Number(before.c || 0),
      backlog: Number(backlog.c || 0),
      through_cursor: cursor,
    })
  },
  $apis.bodyLimit(8192),
)
