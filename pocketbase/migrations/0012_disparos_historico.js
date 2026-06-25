migrate(
  (app) => {
    // Histórico de disparos: cada clique em "Disparar" cria um registro aqui.
    // Os contadores (enviados/erros) são recalculados pelo cron a cada lote.
    const disparos = new Collection({
      name: 'disparos',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'template_id', type: 'text' },
        { name: 'template_nome', type: 'text' },
        { name: 'cluster', type: 'text' },
        { name: 'total', type: 'number' },
        { name: 'enviados', type: 'number' },
        { name: 'erros', type: 'number' },
        {
          name: 'status',
          type: 'select',
          values: ['em_andamento', 'concluido'],
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(disparos)

    // Liga cada comprador enfileirado à campanha (disparo) correspondente.
    const compradores = app.findCollectionByNameOrId('compradores')
    if (!compradores.fields.getByName('acesso_disparo_id')) {
      compradores.fields.add(new TextField({ name: 'acesso_disparo_id' }))
    }
    app.save(compradores)
  },
  (app) => {
    const compradores = app.findCollectionByNameOrId('compradores')
    compradores.fields.removeByName('acesso_disparo_id')
    app.save(compradores)
    app.delete(app.findCollectionByNameOrId('disparos'))
  },
)
