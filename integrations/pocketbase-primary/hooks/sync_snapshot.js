routerAdd('GET', '/backend/v1/sync/snapshot', (e) => {
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

  const allowed = ['compradores', 'ingressos', 'participantes']
  const query = e.request.url.query()
  const collection = query.get('collection') || ''
  if (allowed.indexOf(collection) === -1) return e.badRequestError('SYNC_COLLECTION_INVALID')
  const cursor = query.get('cursor') || ''
  const rawLimit = Number(query.get('limit') || 100)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 100
  const filter = cursor ? 'id > {:cursor}' : ''
  const rows = $app.findRecordsByFilter(collection, filter, 'id', limit + 1, 0, {
    cursor: cursor,
  })
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  const items = page.map((record) => {
    const fields = record.fieldsData()
    const item = {}
    Object.keys(fields).forEach((key) => {
      item[key] = fields[key]
    })
    item.id = record.id
    item.created = record.getString('created')
    item.updated = record.getString('updated')
    return item
  })
  return e.json(200, {
    collection: collection,
    items: items,
    total: $app.countRecords(collection),
    has_more: hasMore,
    next_cursor: page.length ? page[page.length - 1].id : null,
  })
})
