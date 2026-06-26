migrate(
  (app) => {
    // Campos de fila nos participantes (espelho dos do comprador), pra reusar a
    // mesma mecânica de claim/cron para clusters de participantes.
    const participantes = app.findCollectionByNameOrId('participantes')
    const addP = (name, field) => {
      if (!participantes.fields.getByName(name)) participantes.fields.add(field)
    }
    addP(
      'acesso_status',
      new SelectField({
        name: 'acesso_status',
        values: ['na_fila', 'enviando', 'enviado', 'erro'],
        maxSelect: 1,
        required: false,
      }),
    )
    addP('acesso_disparo_id', new TextField({ name: 'acesso_disparo_id' }))
    addP('acesso_template_id', new TextField({ name: 'acesso_template_id' }))
    addP('acesso_enviado_em', new TextField({ name: 'acesso_enviado_em' }))
    addP('acesso_tentativas', new NumberField({ name: 'acesso_tentativas' }))
    addP('acesso_erro', new TextField({ name: 'acesso_erro' }))
    addP('acesso_claim', new TextField({ name: 'acesso_claim' }))
    app.save(participantes)

    // Nome personalizado e audiência na campanha.
    const disparos = app.findCollectionByNameOrId('disparos')
    if (!disparos.fields.getByName('nome')) {
      disparos.fields.add(new TextField({ name: 'nome' }))
    }
    if (!disparos.fields.getByName('audience')) {
      disparos.fields.add(new TextField({ name: 'audience' }))
    }
    app.save(disparos)
  },
  (app) => {
    const participantes = app.findCollectionByNameOrId('participantes')
    ;[
      'acesso_status',
      'acesso_disparo_id',
      'acesso_template_id',
      'acesso_enviado_em',
      'acesso_tentativas',
      'acesso_erro',
      'acesso_claim',
    ].forEach((n) => participantes.fields.removeByName(n))
    app.save(participantes)

    const disparos = app.findCollectionByNameOrId('disparos')
    disparos.fields.removeByName('nome')
    disparos.fields.removeByName('audience')
    app.save(disparos)
  },
)
