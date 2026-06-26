migrate(
  (app) => {
    const ingressos = app.findCollectionByNameOrId('ingressos')
    if (!ingressos.fields.getByName('inac_id')) {
      ingressos.fields.add(new TextField({ name: 'inac_id' }))
    }
    if (!ingressos.fields.getByName('inac_qr')) {
      ingressos.fields.add(new TextField({ name: 'inac_qr' }))
    }
    app.save(ingressos)
  },
  (app) => {
    const ingressos = app.findCollectionByNameOrId('ingressos')
    ingressos.fields.removeByName('inac_id')
    ingressos.fields.removeByName('inac_qr')
    app.save(ingressos)
  },
)
