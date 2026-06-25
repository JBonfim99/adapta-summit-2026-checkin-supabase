migrate(
  (app) => {
    // 1. Create a temporary field for tipo_ingresso with correct type and values
    const col = app.findCollectionByNameOrId('ingressos')
    col.fields.add(
      new SelectField({ name: 'tipo_ingresso_new', values: ['GOLD', 'PLATINUM'], maxSelect: 1 }),
    )

    // Update status options
    const statusField = col.fields.getByName('status')
    statusField.values = ['Pendente', 'Pré-Credenciado', 'enviado', 'erro_webhook']

    app.save(col)

    // 2. Migrate existing data to alignment
    app
      .db()
      .newQuery(
        "UPDATE ingressos SET tipo_ingresso_new = 'GOLD' WHERE tipo_ingresso NOT IN ('GOLD', 'PLATINUM')",
      )
      .execute()
    app
      .db()
      .newQuery(
        "UPDATE ingressos SET tipo_ingresso_new = tipo_ingresso WHERE tipo_ingresso IN ('GOLD', 'PLATINUM')",
      )
      .execute()

    app
      .db()
      .newQuery("UPDATE ingressos SET status = 'Pendente' WHERE status = 'pendente'")
      .execute()
    app
      .db()
      .newQuery("UPDATE ingressos SET status = 'Pré-Credenciado' WHERE status = 'preenchido'")
      .execute()

    // 3. Drop old field and rename the temporary field to take its place
    const col2 = app.findCollectionByNameOrId('ingressos')
    col2.fields.removeByName('tipo_ingresso')
    const newField = col2.fields.getByName('tipo_ingresso_new')
    newField.name = 'tipo_ingresso'
    app.save(col2)
  },
  (app) => {
    const col = app.findCollectionByNameOrId('ingressos')
    const statusField = col.fields.getByName('status')
    statusField.values = ['pendente', 'preenchido', 'enviado', 'erro_webhook']
    app.save(col)

    app
      .db()
      .newQuery("UPDATE ingressos SET status = 'pendente' WHERE status = 'Pendente'")
      .execute()
    app
      .db()
      .newQuery("UPDATE ingressos SET status = 'preenchido' WHERE status = 'Pré-Credenciado'")
      .execute()
  },
)
