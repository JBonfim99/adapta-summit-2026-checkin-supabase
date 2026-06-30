// Fila e histórico do Disparo WhatsApp (BotConversa). Isolado do e-mail (acesso_*).
migrate(
  (app) => {
    const compradores = app.findCollectionByNameOrId('compradores')

    if (!compradores.fields.getByName('wa_status')) {
      compradores.fields.add(
        new SelectField({
          name: 'wa_status',
          values: ['na_fila', 'enviando', 'enviado', 'erro'],
          maxSelect: 1,
          required: false,
        }),
      )
    }
    if (!compradores.fields.getByName('wa_disparo_id')) {
      compradores.fields.add(new TextField({ name: 'wa_disparo_id' }))
    }
    if (!compradores.fields.getByName('wa_tentativas')) {
      compradores.fields.add(new NumberField({ name: 'wa_tentativas' }))
    }
    if (!compradores.fields.getByName('wa_erro')) {
      compradores.fields.add(new TextField({ name: 'wa_erro' }))
    }
    if (!compradores.fields.getByName('wa_claim')) {
      compradores.fields.add(new TextField({ name: 'wa_claim' }))
    }
    if (!compradores.fields.getByName('wa_enviado_em')) {
      compradores.fields.add(new TextField({ name: 'wa_enviado_em' }))
    }
    app.save(compradores)

    const disparos_wa = new Collection({
      name: 'disparos_wa',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'nome', type: 'text' },
        { name: 'cluster', type: 'text' },
        { name: 'total', type: 'number' },
        { name: 'enviados', type: 'number' },
        { name: 'erros', type: 'number' },
        { name: 'status', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(disparos_wa)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('disparos_wa'))
    } catch (e) {}
    const compradores = app.findCollectionByNameOrId('compradores')
    compradores.fields.removeByName('wa_status')
    compradores.fields.removeByName('wa_disparo_id')
    compradores.fields.removeByName('wa_tentativas')
    compradores.fields.removeByName('wa_erro')
    compradores.fields.removeByName('wa_claim')
    compradores.fields.removeByName('wa_enviado_em')
    app.save(compradores)
  },
)
