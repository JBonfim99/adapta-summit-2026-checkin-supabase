migrate(
  (app) => {
    const compradores = new Collection({
      name: 'compradores',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        { name: 'nome', type: 'text', required: true },
        { name: 'email', type: 'email', required: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_compradores_email ON compradores (email)'],
    })
    app.save(compradores)

    const participantes = new Collection({
      name: 'participantes',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: null,
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        { name: 'nome_completo', type: 'text', required: true },
        { name: 'email', type: 'email', required: true },
        { name: 'cpf', type: 'text', required: true },
        { name: 'telefone', type: 'text', required: true },
        { name: 'nome_empresa', type: 'text', required: true },
        { name: 'cargo', type: 'text', required: true },
        { name: 'nicho', type: 'text', required: true },
        { name: 'num_funcionarios', type: 'text', required: true },
        { name: 'faturamento_anual', type: 'text', required: true },
        { name: 'areas_ajuda', type: 'json' },
        { name: 'expectativa_aprendizado', type: 'text' },
        { name: 'expectativa_experiencia', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(participantes)

    const ingressos = new Collection({
      name: 'ingressos',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'comprador_id',
          type: 'relation',
          collectionId: compradores.id,
          maxSelect: 1,
          required: true,
        },
        { name: 'pedido_id', type: 'text', required: true },
        { name: 'tipo_ingresso', type: 'text', required: true },
        {
          name: 'status',
          type: 'select',
          values: ['pendente', 'preenchido', 'enviado', 'erro_webhook'],
          maxSelect: 1,
          required: true,
        },
        { name: 'participante_id', type: 'relation', collectionId: participantes.id, maxSelect: 1 },
        { name: 'preenchido_em', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(ingressos)

    participantes.fields.add(
      new RelationField({
        name: 'ingresso_id',
        collectionId: ingressos.id,
        maxSelect: 1,
        required: true,
      }),
    )
    app.save(participantes)

    const tokens_acesso = new Collection({
      name: 'tokens_acesso',
      type: 'base',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: 'comprador_id',
          type: 'relation',
          collectionId: compradores.id,
          maxSelect: 1,
          required: true,
        },
        { name: 'token', type: 'text', required: true },
        { name: 'usado', type: 'bool' },
        { name: 'expira_em', type: 'date', required: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_tokens_acesso_token ON tokens_acesso (token)'],
    })
    app.save(tokens_acesso)

    const links_participante = new Collection({
      name: 'links_participante',
      type: 'base',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: 'ingresso_id',
          type: 'relation',
          collectionId: ingressos.id,
          maxSelect: 1,
          required: true,
        },
        { name: 'token', type: 'text', required: true },
        { name: 'usado', type: 'bool' },
        { name: 'expira_em', type: 'date', required: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE UNIQUE INDEX idx_links_participante_token ON links_participante (token)'],
    })
    app.save(links_participante)

    const webhooks_log = new Collection({
      name: 'webhooks_log',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'ingresso_id', type: 'relation', collectionId: ingressos.id, maxSelect: 1 },
        { name: 'status', type: 'number' },
        { name: 'method', type: 'text' },
        { name: 'response', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    })
    app.save(webhooks_log)
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('webhooks_log'))
    app.delete(app.findCollectionByNameOrId('links_participante'))
    app.delete(app.findCollectionByNameOrId('tokens_acesso'))
    app.delete(app.findCollectionByNameOrId('ingressos'))
    app.delete(app.findCollectionByNameOrId('participantes'))
    app.delete(app.findCollectionByNameOrId('compradores'))
  },
)
