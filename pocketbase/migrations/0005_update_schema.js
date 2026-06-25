migrate(
  (app) => {
    // 1. Clean invalid data before applying schema constraints
    app
      .db()
      .newQuery(
        "DELETE FROM ingressos WHERE status NOT IN ('Pendente', 'Pré-Credenciado') OR status IS NULL",
      )
      .execute()
    app
      .db()
      .newQuery(
        "DELETE FROM ingressos WHERE tipo_ingresso NOT IN ('GOLD', 'PLATINUM') OR tipo_ingresso IS NULL",
      )
      .execute()

    // 2. Enforce schema limits on ingressos
    const ingressos = app.findCollectionByNameOrId('ingressos')
    const statusField = ingressos.fields.getByName('status')
    statusField.values = ['Pendente', 'Pré-Credenciado']
    app.save(ingressos)

    // 3. Extend compradores schema
    const compradores = app.findCollectionByNameOrId('compradores')
    if (!compradores.fields.getByName('documento')) {
      compradores.fields.add(new TextField({ name: 'documento' }))
    }
    if (!compradores.fields.getByName('uf')) {
      compradores.fields.add(new TextField({ name: 'uf' }))
    }
    if (!compradores.fields.getByName('cidade')) {
      compradores.fields.add(new TextField({ name: 'cidade' }))
    }
    if (!compradores.fields.getByName('telefone')) {
      compradores.fields.add(new TextField({ name: 'telefone' }))
    }
    compradores.addIndex('idx_compradores_documento', false, 'documento', '')
    app.save(compradores)
  },
  (app) => {
    const ingressos = app.findCollectionByNameOrId('ingressos')
    const statusField = ingressos.fields.getByName('status')
    statusField.values = ['Pendente', 'Pré-Credenciado', 'enviado', 'erro_webhook']
    app.save(ingressos)

    const compradores = app.findCollectionByNameOrId('compradores')
    compradores.fields.removeByName('documento')
    compradores.fields.removeByName('uf')
    compradores.fields.removeByName('cidade')
    compradores.fields.removeByName('telefone')
    compradores.removeIndex('idx_compradores_documento')
    app.save(compradores)
  },
)
