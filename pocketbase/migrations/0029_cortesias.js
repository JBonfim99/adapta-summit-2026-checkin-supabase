migrate(
  (app) => {
    const collection = new Collection({
      type: 'base',
      name: 'cortesias',
      fields: [
        { type: 'text', name: 'anfitriao', required: true },
        { type: 'text', name: 'token', required: true },
        { type: 'text', name: 'tipo_ingresso' },
        { type: 'number', name: 'limite' },
        { type: 'number', name: 'usados' },
        { type: 'bool', name: 'ativo' },
        { type: 'text', name: 'comprador_id' },
        { type: 'autodate', name: 'created', onCreate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_cortesias_token` ON `cortesias` (`token`)'],
    })
    app.save(collection)

    const ing = app.findCollectionByNameOrId('ingressos')
    if (!ing.fields.getByName('origem')) ing.fields.add(new TextField({ name: 'origem' }))
    if (!ing.fields.getByName('cortesia_id')) ing.fields.add(new TextField({ name: 'cortesia_id' }))
    app.save(ing)
  },
  (app) => {
    try {
      const c = app.findCollectionByNameOrId('cortesias')
      app.delete(c)
    } catch (_) {}
    try {
      const ing = app.findCollectionByNameOrId('ingressos')
      ing.fields.removeByName('origem')
      ing.fields.removeByName('cortesia_id')
      app.save(ing)
    } catch (_) {}
  },
)
