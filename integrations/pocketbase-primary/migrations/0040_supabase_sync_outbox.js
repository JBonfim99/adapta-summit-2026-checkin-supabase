migrate(
  (app) => {
    const outbox = new Collection({
      type: 'base',
      name: 'sync_outbox',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'event_id', required: true },
        {
          type: 'select',
          name: 'source_table',
          required: true,
          maxSelect: 1,
          values: [
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
          ],
        },
        { type: 'text', name: 'record_id', required: true },
        {
          type: 'select',
          name: 'operation',
          required: true,
          maxSelect: 1,
          values: ['create', 'update', 'delete'],
        },
        { type: 'json', name: 'payload' },
        { type: 'date', name: 'source_updated_at', required: true },
        {
          type: 'select',
          name: 'state',
          required: true,
          maxSelect: 1,
          values: ['pending', 'delivered'],
        },
        { type: 'date', name: 'delivered_at' },
        { type: 'autodate', name: 'created', onCreate: true },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_sync_outbox_event ON sync_outbox (event_id)',
        'CREATE INDEX idx_sync_outbox_queue ON sync_outbox (state, created, id)',
        'CREATE INDEX idx_sync_outbox_record ON sync_outbox (source_table, record_id, created)',
      ],
    })
    app.save(outbox)

    const control = new Collection({
      type: 'base',
      name: 'sync_control',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'bool', name: 'block_writes' },
        { type: 'text', name: 'note' },
        { type: 'date', name: 'last_triggered_at' },
        { type: 'autodate', name: 'created', onCreate: true },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
    })
    app.save(control)

    const record = new Record(control)
    record.set('block_writes', false)
    record.set('note', 'Supabase standby initialized')
    app.save(record)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('sync_outbox'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('sync_control'))
    } catch (_) {}
  },
)
