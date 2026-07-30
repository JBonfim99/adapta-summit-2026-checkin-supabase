onRecordDelete(
  (e) => {
    const record = e.record
    const outbox = $app.findCollectionByNameOrId('sync_outbox')
    const event = new Record(outbox)
    const occurredAt = new Date().toISOString()
    event.set('event_id', $security.randomString(48))
    event.set('source_table', record.collection().name)
    event.set('record_id', record.id)
    event.set('operation', 'delete')
    event.set('payload', {})
    event.set('source_updated_at', occurredAt)
    event.set('state', 'pending')
    $app.save(event)
    e.next()
  },
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
)
