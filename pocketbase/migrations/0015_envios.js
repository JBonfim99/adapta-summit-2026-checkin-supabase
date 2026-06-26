migrate(
  (app) => {
    // Registro imutável de envios: 1 linha por (disparo, contato) no momento do
    // envio. Garante auditoria histórica mesmo que o comprador receba outros
    // disparos depois (o vínculo no comprador é sobrescrito; aqui não).
    const envios = new Collection({
      name: 'envios',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'disparo_id', type: 'text' },
        { name: 'comprador_id', type: 'text' },
        { name: 'nome', type: 'text' },
        { name: 'email', type: 'text' },
        { name: 'status', type: 'select', values: ['enviado', 'erro'], maxSelect: 1 },
        { name: 'enviado_em', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_envios_disparo ON envios (disparo_id)'],
    })
    app.save(envios)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('envios'))
  },
)
