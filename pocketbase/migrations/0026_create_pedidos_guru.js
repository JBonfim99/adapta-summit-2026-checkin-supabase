// Coleção de auditoria/idempotência dos pedidos recebidos da Guru.
// transacao_id (= payment.marketplace_id) tem índice ÚNICO: é o que garante que
// os 2-3 webhooks da mesma compra gerem ingresso uma única vez.
migrate(
  (app) => {
    const c = new Collection({
      name: 'pedidos_guru',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'transacao_id', type: 'text', required: true },
        { name: 'status', type: 'text' },
        { name: 'email', type: 'text' },
        { name: 'comprador_id', type: 'text' },
        { name: 'ingressos', type: 'number' },
        { name: 'email_status', type: 'text' },
        { name: 'payload', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_pedidos_guru_transacao ON pedidos_guru (transacao_id)'],
    })
    app.save(c)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('pedidos_guru'))
  },
)
