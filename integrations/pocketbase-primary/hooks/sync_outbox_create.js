onRecordCreate(
  (e) => {
    const record = e.record
    const outbox = $app.findCollectionByNameOrId('sync_outbox')
    const event = new Record(outbox)
    const fields = record.fieldsData()
    const payload = {}
    const occurredAt = new Date().toISOString()
    Object.keys(fields).forEach((key) => {
      payload[key] = fields[key]
    })
    payload.id = record.id
    payload.created_at = record.getString('created') || occurredAt
    payload.updated_at = occurredAt
    event.set('event_id', $security.randomString(48))
    event.set('source_table', record.collection().name)
    event.set('record_id', record.id)
    event.set('operation', 'create')
    event.set('payload', payload)
    event.set('source_updated_at', occurredAt)
    event.set('state', 'pending')
    $app.save(event)
    e.next()
  },
  'compradores',
  'ingressos',
  'participantes',
)
