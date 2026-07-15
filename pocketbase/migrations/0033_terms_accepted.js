// Registra o aceite da autorização de uso de imagem/dados no participante.
migrate(
  (app) => {
    const coll = app.findCollectionByNameOrId('participantes')
    if (!coll.fields.getByName('terms_accepted_at')) {
      coll.fields.add(new TextField({ name: 'terms_accepted_at' }))
    }
    app.save(coll)
  },
  (app) => {
    const coll = app.findCollectionByNameOrId('participantes')
    coll.fields.removeByName('terms_accepted_at')
    app.save(coll)
  },
)
