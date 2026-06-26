migrate(
  (app) => {
    // Registro de "saúde" para verificar se o cron roda neste ambiente.
    const cron_health = new Collection({
      name: 'cron_health',
      type: 'base',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'last_run', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(cron_health)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('cron_health'))
  },
)
