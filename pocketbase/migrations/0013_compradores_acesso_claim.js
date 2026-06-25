migrate(
  (app) => {
    // Marcador de reivindicação de lote: garante que cron e frontend, mesmo
    // rodando ao mesmo tempo, nunca processem o mesmo comprador duas vezes.
    const compradores = app.findCollectionByNameOrId('compradores')
    if (!compradores.fields.getByName('acesso_claim')) {
      compradores.fields.add(new TextField({ name: 'acesso_claim' }))
    }
    app.save(compradores)
  },
  (app) => {
    const compradores = app.findCollectionByNameOrId('compradores')
    compradores.fields.removeByName('acesso_claim')
    app.save(compradores)
  },
)
