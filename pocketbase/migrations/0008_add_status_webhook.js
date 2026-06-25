migrate(
  (app) => {
    // Separa o estado de ENTREGA do webhook (pendente/enviado/erro) do estado
    // de CREDENCIAMENTO (status: Pendente/Pré-Credenciado). Antes os dois
    // compartilhavam o mesmo campo `status`, o que era inválido depois da 0005.
    const ingressos = app.findCollectionByNameOrId('ingressos')
    if (!ingressos.fields.getByName('status_webhook')) {
      ingressos.fields.add(
        new SelectField({
          name: 'status_webhook',
          values: ['pendente', 'enviado', 'erro'],
          maxSelect: 1,
          required: false,
        }),
      )
      app.save(ingressos)
    }

    // Inicializa as linhas existentes como 'pendente'.
    app
      .db()
      .newQuery(
        "UPDATE ingressos SET status_webhook = 'pendente' WHERE status_webhook = '' OR status_webhook IS NULL",
      )
      .execute()
  },
  (app) => {
    const ingressos = app.findCollectionByNameOrId('ingressos')
    if (ingressos.fields.getByName('status_webhook')) {
      ingressos.fields.removeByName('status_webhook')
      app.save(ingressos)
    }
  },
)
