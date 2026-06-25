migrate(
  (app) => {
    const coll = app.findCollectionByNameOrId('webhooks_log')
    if (!coll.fields.getByName('evento')) {
      coll.fields.add(new TextField({ name: 'evento' }))
    }
    if (!coll.fields.getByName('detalhe')) {
      coll.fields.add(new TextField({ name: 'detalhe' }))
    }
    if (!coll.fields.getByName('payload')) {
      coll.fields.add(new TextField({ name: 'payload' }))
    }
    app.save(coll)
  },
  (app) => {
    const coll = app.findCollectionByNameOrId('webhooks_log')
    coll.fields.removeByName('evento')
    coll.fields.removeByName('detalhe')
    coll.fields.removeByName('payload')
    app.save(coll)
  },
)
