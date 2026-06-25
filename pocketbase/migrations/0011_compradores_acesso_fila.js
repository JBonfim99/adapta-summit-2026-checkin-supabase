migrate(
  (app) => {
    const compradores = app.findCollectionByNameOrId('compradores')

    if (!compradores.fields.getByName('acesso_status')) {
      compradores.fields.add(
        new SelectField({
          name: 'acesso_status',
          values: ['na_fila', 'enviando', 'enviado', 'erro'],
          maxSelect: 1,
          required: false,
        }),
      )
    }
    if (!compradores.fields.getByName('acesso_template_id')) {
      compradores.fields.add(new TextField({ name: 'acesso_template_id' }))
    }
    if (!compradores.fields.getByName('acesso_enviado_em')) {
      // ISO string (texto) para facilitar escrita em massa via SQL.
      compradores.fields.add(new TextField({ name: 'acesso_enviado_em' }))
    }
    if (!compradores.fields.getByName('acesso_tentativas')) {
      compradores.fields.add(new NumberField({ name: 'acesso_tentativas' }))
    }
    if (!compradores.fields.getByName('acesso_erro')) {
      compradores.fields.add(new TextField({ name: 'acesso_erro' }))
    }

    app.save(compradores)
  },
  (app) => {
    const compradores = app.findCollectionByNameOrId('compradores')
    compradores.fields.removeByName('acesso_status')
    compradores.fields.removeByName('acesso_template_id')
    compradores.fields.removeByName('acesso_enviado_em')
    compradores.fields.removeByName('acesso_tentativas')
    compradores.fields.removeByName('acesso_erro')
    app.save(compradores)
  },
)
