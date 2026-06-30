// Suporte a seleção de fluxo + mapeamento de variáveis no Disparo WhatsApp.
// flow vazio = pré-credenciamento (catch webhook, comportamento atual).
// flow = id do fluxo BotConversa -> cria/atualiza contato, seta custom fields, envia fluxo.
// mapping = JSON [{ field_id, source, value }] aplicado por contato.
migrate(
  (app) => {
    const d = app.findCollectionByNameOrId('disparos_wa')
    if (!d.fields.getByName('flow')) {
      d.fields.add(new TextField({ name: 'flow' }))
    }
    if (!d.fields.getByName('flow_nome')) {
      d.fields.add(new TextField({ name: 'flow_nome' }))
    }
    if (!d.fields.getByName('mapping')) {
      d.fields.add(new TextField({ name: 'mapping', max: 20000 }))
    }
    app.save(d)
  },
  (app) => {
    const d = app.findCollectionByNameOrId('disparos_wa')
    d.fields.removeByName('flow')
    d.fields.removeByName('flow_nome')
    d.fields.removeByName('mapping')
    app.save(d)
  },
)
